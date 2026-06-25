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
import { SK, NOTICE_YTD_KEY } from './paycalc-migrations.js';
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
      content:  document.getElementById('helpLightboxContent'),
      closeBtn: document.getElementById('helpLightboxClose'),
    });

    function openHelp(key) {
      const data = HELP_CONTENT[key];
      if (!data) return;
      titleEl.textContent = data.title;
      listEl.innerHTML = data.tips.map(t => `<li>${t}</li>`).join('');
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
      content:  document.getElementById('welcomeLightboxContent'),
      closeBtn: document.getElementById('welcomeLightboxClose'),
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

    if (!lsGet(WELCOME_KEY)) welcome.open();
  })();

  // ── YTD NOTICE ──────────────────────────────────────────────────────────────
  // Shown once after the welcome lightbox has been dismissed.
  (function () {
    const NOTICE_DATE = '6 Apr 2026';
    if (isNoticeExpired(NOTICE_DATE, 90) && !lsGet(NOTICE_YTD_KEY)) { lsSet(NOTICE_YTD_KEY, '1'); return; }
    if (!lsGet(WELCOME_KEY) || lsGet(NOTICE_YTD_KEY)) return;

    const lb = document.getElementById('noticeYtdLightbox');
    if (!lb) return;

    const notice = createLightbox({
      overlay:  lb,
      content:  document.getElementById('noticeYtdContent'),
      closeBtn: document.getElementById('noticeYtdClose'),
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
      'decimalConverterToggle', open => { if (open) input.focus(); });

    function convert() {
      const val = parseFloat(input.value);
      if (isNaN(val) || val < 0) { result.textContent = '–'; return; }
      const totalMins = Math.round(val * 60);
      const hrs  = Math.floor(totalMins / 60);
      const mins = totalMins % 60;
      if (hrs === 0) {
        result.textContent = `${mins} min${mins !== 1 ? 's' : ''}`;
      } else if (mins === 0) {
        result.textContent = `${hrs} hr${hrs !== 1 ? 's' : ''}`;
      } else {
        result.textContent = `${hrs} hr${hrs !== 1 ? 's' : ''} ${mins} min${mins !== 1 ? 's' : ''}`;
      }
    }

    input.addEventListener('input', convert);
  })();

  return { openAboutLightbox };
}
