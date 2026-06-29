// @ts-check
/**
 * paycalc-lightboxes.js — Lightbox and overlay initialisation for paycalc.html.
 *
 * Owns: About panel, Help tooltip lightbox, Welcome first-visit lightbox,
 *   YTD notice, Decimal hours converter card.
 * Does NOT own: pay calculation (paycalc-app.js), period arithmetic (paycalc-periods.js),
 *   settings persistence (paycalc-settings.js).
 * Edit here for: lightbox content, first-visit notice, decimal converter logic.
 */

import { createLightbox, initCardCollapse } from './overlay.js';
import { initAboutLightbox } from './about-lightbox.js';
import { HELP_CONTENT } from './paycalc-help.js';
import { archiveNotice, isNoticeExpired } from './nav-panel.js';
import { lsGet, lsSet } from './ls.js';
import { GRADES } from './paycalc-calc.js';
import { SK, NOTICE_YTD_KEY, hasPendingLegacyMigration, resolveLegacyMigration,
         readPayslipActuals, writePayslipActuals, clearPayslipActuals } from './paycalc-migrations.js';
import { getLoggedMember } from './paycalc-settings.js';

// Shared seen-flag key — used by the welcome lightbox and the YTD notice (which
// only shows after welcome has been dismissed). Defined at module level so both
// IIFEs read the same string without risk of divergence.
const WELCOME_KEY = 'myb_pc_pay_welcome_shown';

/**
 * Initialise all paycalc lightboxes and the decimal hours converter.
 * Returns the openAboutLightbox handle so the coordinator can pass it to initNavPanel.
 *
 * @returns {{ openAboutLightbox: (() => void)|null }}
 */
export function initPaycalcLightboxes() {
  // One-time notices must not stack — overlay.js manages a single active overlay
  // (history entry + focus trap), so two open at once fight over Back/Escape/Tab.
  // The data-ownership prompt is highest priority (it guards another member's pay
  // data and forces a reload on resolution), so when it's pending we suppress the
  // welcome and YTD notices this load; they reappear next load once it's resolved.
  // (welcome and YTD are already mutually exclusive — YTD only shows after welcome
  // has been dismissed — so this guard is the only coordination needed.)
  const _ownerPending = hasPendingLegacyMigration(getLoggedMember()?.name);

  // ── ABOUT LIGHTBOX ──────────────────────────────────────────────────────────
  // Lifecycle, SW status, bug link, and print button are the shared about-lightbox.js.
  // Header logo is a back-to-calendar button — About opens from the drawer logo.
  let openAboutLightbox = null;
  (function () {
    const about = initAboutLightbox({
      appLabel: 'MYB Pay Calculator',
      getUserName: () => getLoggedMember()?.name,
    });
    if (about) openAboutLightbox = about.open;

    const appIcon = document.getElementById('appIcon');
    if (!appIcon) return;
    appIcon.title = 'Back to calendar';
    appIcon.setAttribute('aria-label', 'Back to calendar');
    appIcon.addEventListener('click', () => { window.location.href = './index.html'; });
  })();

  // ── HELP LIGHTBOX ───────────────────────────────────────────────────────────
  // Generic lightbox driven by HELP_CONTENT — opened by any .help-btn[data-help].
  (function () {
    const lb      = document.getElementById('helpLightbox');
    const titleEl = document.getElementById('helpLightboxTitle');
    const listEl  = document.getElementById('helpLightboxList');
    if (!lb) return;

    const help = createLightbox({
      overlay:  lb,
      content:  /** @type {Element|undefined} */ (document.getElementById('helpLightboxContent') ?? undefined),
      closeBtn: /** @type {Element|undefined} */ (document.getElementById('helpLightboxClose') ?? undefined),
    });

    function openHelp(/** @type {any} */ key) {
      const data = /** @type {Record<string, any>} */ (HELP_CONTENT)[key];
      if (!data) return;
      if (titleEl) titleEl.textContent = data.title;
      if (listEl) listEl.innerHTML = data.tips.map((/** @type {any} */ t) => `<li>${t}</li>`).join('');
      help.open();
    }

    document.querySelectorAll('.help-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        openHelp(/** @type {HTMLElement} */ (btn).dataset.help);
      });
    });
  })();

  // ── WELCOME LIGHTBOX ────────────────────────────────────────────────────────
  // Shown once, on the very first visit to the pay calculator.
  (function () {
    const lb = document.getElementById('welcomeLightbox');
    if (!lb) return;

    const welcome = createLightbox({
      overlay:  lb,
      content:  /** @type {Element|undefined} */ (document.getElementById('welcomeLightboxContent') ?? undefined),
      closeBtn: /** @type {Element|undefined} */ (document.getElementById('welcomeLightboxClose') ?? undefined),
      onOpen() {
        const badge = document.getElementById('welcomeGradeBadge');
        if (badge) {
          const g = lsGet(SK.grade);
          badge.textContent = (g && GRADES[g] ? GRADES[g].label : 'CEA & CES') + ' grade';
        }
      },
      onClose: () => lsSet(WELCOME_KEY, '1'),
    });

    lb.querySelector('.welcome-guide-link')?.addEventListener('click', () => welcome.close());

    if (!lsGet(WELCOME_KEY) && !_ownerPending) welcome.open();
  })();

  // ── YTD NOTICE ──────────────────────────────────────────────────────────────
  // Shown once after the welcome lightbox has been dismissed.
  (function () {
    const NOTICE_DATE = '6 Apr 2026';
    if (isNoticeExpired(NOTICE_DATE, 90) && !lsGet(NOTICE_YTD_KEY)) { lsSet(NOTICE_YTD_KEY, '1'); return; }
    if (!lsGet(WELCOME_KEY) || lsGet(NOTICE_YTD_KEY)) return;
    if (_ownerPending) return;   // data-ownership prompt takes priority this load

    const lb = document.getElementById('noticeYtdLightbox');
    if (!lb) return;

    const notice = createLightbox({
      overlay:  lb,
      content:  /** @type {Element|undefined} */ (document.getElementById('noticeYtdContent') ?? undefined),
      closeBtn: /** @type {Element|undefined} */ (document.getElementById('noticeYtdClose') ?? undefined),
      onClose: () => {
        archiveNotice({
          id:      'ytd_2627',
          title:   'Enter your YTD figures',
          section: 'Pay',
          date:    NOTICE_DATE,
          body:    'Open ⚙️ Your Settings and enter your YTD Gross Pay and YTD Tax Paid from your most recent payslip for accurate monthly tax estimates.',
        });
        lsSet(NOTICE_YTD_KEY, '1');
      },
    });

    notice.open();
  })();

  // ── DECIMAL HOURS CONVERTER ─────────────────────────────────────────────────
  (function () {
    const toggle = document.getElementById('decimalConverterToggle');
    const body   = document.getElementById('decimalConverterBody');
    const input  = /** @type {HTMLInputElement|null} */ (document.getElementById('decimalHrsInput'));
    const result = document.getElementById('decimalHrsResult');
    if (!toggle || !body || !input || !result) return;

    initCardCollapse('decimalConverterToggle', 'decimalConverterBody',
      'decimalConverterToggle', (/** @type {any} */ open) => { if (open) input.focus(); });

    function convert() {
      const _input  = /** @type {HTMLInputElement} */ (input);
      const _result = /** @type {HTMLElement} */ (result);
      const val = parseFloat(_input.value);
      if (isNaN(val) || val < 0) { _result.textContent = '–'; return; }
      const totalMins = Math.round(val * 60);
      const hrs  = Math.floor(totalMins / 60);
      const mins = totalMins % 60;
      if (hrs === 0) {
        _result.textContent = `${mins} min${mins !== 1 ? 's' : ''}`;
      } else if (mins === 0) {
        _result.textContent = `${hrs} hr${hrs !== 1 ? 's' : ''}`;
      } else {
        _result.textContent = `${hrs} hr${hrs !== 1 ? 's' : ''} ${mins} min${mins !== 1 ? 's' : ''}`;
      }
    }

    input.addEventListener('input', convert);
  })();

  // ── SHARED-DEVICE DATA OWNERSHIP PROMPT (v14.25) ────────────────────────────
  // If the device has unclaimed legacy/shared paycalc data and the signed-in member
  // hasn't resolved ownership, ask before any of it is assigned (replaces the old
  // silent "first member to load inherits it" behaviour — wrong on a shared phone).
  // The ✕ ("decide later") leaves the data untouched and the prompt reappears next load.
  // Runs after loadSettings (initPaycalcLightboxes is the last init step), so the
  // calculator already shows the member's own namespaced view behind the prompt.
  (function () {
    const memberName = getLoggedMember()?.name;
    if (!hasPendingLegacyMigration(memberName)) return;
    const lb = document.getElementById('dataOwnerLightbox');
    if (!lb) return;
    const owner = createLightbox({
      overlay:  lb,
      content:  /** @type {Element|undefined} */ (document.getElementById('dataOwnerContent') ?? undefined),
      closeBtn: /** @type {Element|undefined} */ (document.getElementById('dataOwnerClose') ?? undefined),
    });
    document.getElementById('dataOwnerMine')?.addEventListener('click', () => {
      resolveLegacyMigration(memberName, 'mine');
      window.location.reload();   // reload so loadSettings reads the just-moved data
    });
    document.getElementById('dataOwnerFresh')?.addEventListener('click', () => {
      resolveLegacyMigration(memberName, 'fresh');
      window.location.reload();
    });
    owner.open();
  })();

  // ── OWNER-ONLY PAYSLIP ACTUALS IMPORT (device-local; v14.69) ────────────────
  // Real payslip figures are never served (moved out of roster-data.js at v14.68).
  // G. Miller seeds them once per device here; paycalc-app.js/-hpp.js then show the
  // actual-vs-estimate comparison from localStorage. Only ever visible to G. Miller.
  (function () {
    if (getLoggedMember()?.name !== 'G. Miller') return;
    const trigger = document.getElementById('actualsImportBtn');
    const lb      = document.getElementById('actualsLightbox');
    if (!trigger || !lb) return;
    trigger.hidden = false;

    const input  = /** @type {HTMLTextAreaElement|null} */ (document.getElementById('actualsInput'));
    const status = document.getElementById('actualsStatus');
    const setStatus = (/** @type {string} */ msg) => { if (status) status.textContent = msg; };

    const dialog = createLightbox({
      overlay:  lb,
      content:  /** @type {Element|undefined} */ (document.getElementById('actualsContent') ?? undefined),
      closeBtn: /** @type {Element|undefined} */ (document.getElementById('actualsClose') ?? undefined),
      onOpen() {
        const stored = readPayslipActuals();
        const n = Object.keys(stored).length;
        if (input) input.value = n ? JSON.stringify(stored, null, 1) : '';
        setStatus(n ? `${n} period${n !== 1 ? 's' : ''} stored on this device.`
                    : 'No actuals stored on this device.');
      },
    });

    trigger.addEventListener('click', () => dialog.open());

    document.getElementById('actualsImport')?.addEventListener('click', () => {
      const raw = (input?.value || '').trim();
      if (!raw) { setStatus('Paste your JSON first.'); return; }
      let parsed;
      try { parsed = JSON.parse(raw); }
      catch { setStatus('That is not valid JSON — check the text and try again.'); return; }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        setStatus('Expected a JSON object keyed by payday date.'); return;
      }
      const keys = Object.keys(parsed);
      // Require the numeric fields the result display reads (gross/tax/ni/net), so a
      // malformed paste can never reach fmt(undefined) and TypeError inside calculate().
      // sl/varPay are optional (treated as absent when missing).
      const _num = ['gross', 'tax', 'ni', 'net'];
      const ok = keys.length > 0 && keys.every(k =>
        /^\d{4}-\d{2}-\d{2}$/.test(k) && parsed[k] && typeof parsed[k] === 'object' &&
        _num.every(f => typeof parsed[k][f] === 'number' && isFinite(parsed[k][f])));
      if (!ok) { setStatus('Each key must be a YYYY-MM-DD date with numeric gross, tax, ni and net.'); return; }
      const n = writePayslipActuals(parsed);
      setStatus(`Imported ${n} period${n !== 1 ? 's' : ''}. Reloading…`);
      window.location.reload();
    });

    document.getElementById('actualsClear')?.addEventListener('click', () => {
      clearPayslipActuals();
      setStatus('Cleared. Reloading…');
      window.location.reload();
    });
  })();

  return { openAboutLightbox };
}
