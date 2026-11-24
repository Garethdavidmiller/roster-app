// @ts-check
/**
 * paycalc-lightboxes.js — Lightbox and overlay initialisation for paycalc.html.
 *
 * Owns: About panel, the `?` panels' wiring (the shared Tips panel; content in paycalc-help.js), the
 *   page's two one-time notices (Year to Date, then the Holiday Pay Premium notice — one opener,
 *   `showPayNotice`), Decimal hours converter card, the data-ownership prompt and the developer-only
 *   payslip actuals import.
 *   (The Welcome first-visit lightbox was RETIRED at v19.36 and is not here.)
 * Does NOT own: pay calculation (paycalc-app.js), period arithmetic (paycalc-periods.js),
 *   settings persistence (paycalc-settings.js).
 * Edit here for: lightbox content, first-visit notice, the decimal converter's wiring (its reading
 *   and its words are `decimalHoursText`, paycalc-inputs.js, which is pure and unit-tested).
 */

import { createLightbox, initCardCollapse, openNoticeIfClear, followLinkOutOf, openCardNamedByHash } from './overlay.js';
import { initAboutLightbox, wireHeaderLogo } from './about-lightbox.js';
import { HELP_CONTENT } from './paycalc-help.js';
import { initTipsLightbox } from './tips-lightbox.js';
import { archiveNotice, isNoticeExpired } from './notice-archive.js';
import { lsGet, lsSet, lsAvailable } from './ls.js';
import { decimalHoursText } from './paycalc-inputs.js';
import { NOTICE_YTD_KEY, NOTICE_HPP_KEY, hasPendingLegacyMigration, resolveLegacyMigration,
         readPayslipActuals, writePayslipActuals, clearPayslipActuals, isActualsDev } from './paycalc-migrations.js';
import { getLoggedMember } from './paycalc-settings.js';
import { premiumStillToEstimate } from './paycalc-hpp.js';
import { TAX_YEARS } from './paycalc-calc.js';

import { setStatus } from './status-text.js';

/**
 * The Year to Date notice's posting date, and so its end: it is offered for 90 days from it. A
 * module constant because the premium notice behind it asks the same question — see `showHppNotice`.
 */
const YTD_NOTICE_DATE = '28 Aug 2026';
/** How long the Year to Date notice is offered, in days from `YTD_NOTICE_DATE`. */
const YTD_NOTICE_DAYS = 90;
/**
 * The page chrome every Pay Calculator view needs, the refusal card's included: the About panel
 * (lifecycle, SW status, bug link and print button are the shared about-lightbox.js) and the header
 * logo as a back-to-calendar button — About opens from the drawer head. Returns About's OPEN, for
 * `initNavPanel`'s `onLogoClick`, never the object (about-lightbox.js says what that cost).
 *
 * Its own export because the unsupported-role card wires the drawer too and, until Nov 2026, did not
 * wire this: the drawer head ("about this app") and the header logo ("Back to calendar") did nothing
 * there. The refusal opens none of the page's other lightboxes, so it cannot take them all.
 * @returns {(() => void)|null}
 */
export function initPaycalcAbout() {
  const about = initAboutLightbox({
    appLabel: 'Marylebone Roster — Pay Calculator',
    getUserName: () => getLoggedMember()?.name,
  });
  wireHeaderLogo();   // the header logo goes back to the calendar (about-lightbox.js)
  return about?.open ?? null;
}

/**
 * Initialise all paycalc lightboxes and the decimal hours converter.
 *
 * Returns the openAboutLightbox handle so the coordinator can pass it to initNavPanel, and
 * `showPayNotice` — the opener of this page's one-time notices, DEFERRED rather than fired here.
 * Everything else this page can put on screen by itself must have had its turn first; see the note
 * on the Year to Date notice.
 *
 * @returns {{ openAboutLightbox: (() => void)|null, showPayNotice: () => void }}
 */
export function initPaycalcLightboxes() {
  // One-time notices must not stack — overlay.js manages a single active overlay
  // (history entry + focus trap), so two open at once fight over Back/Escape/Tab.
  //
  // THE PAGE'S NOTICES GO LAST, ALWAYS — the Year to Date notice, then the Holiday Pay Premium
  // estimate notice, second and never on the same load (paycalc-notice-order.test.mjs). They are the
  // lowest-stakes things this page can open: the ownership prompt guards another member's pay data and
  // forces a reload, and the forced set-password overlay is a block the member has to satisfy. A
  // prompt about copying figures off a payslip must never sit in front of either. Two guards, and they
  // catch different cases:
  //
  //   `_ownerPending`  — a WILL-OPEN guard, read here, before the ownership prompt has opened.
  //   `openNoticeIfClear` — an IS-OPEN guard, read at open time, for anything already on screen.
  //
  // Neither could see the forced password overlay, because that one is decided AFTER an auth
  // round-trip while this function runs synchronously at init — so until v21.91 the Year to Date
  // notice simply won the race and appeared first. That is why the opener below is returned rather than
  // called: the coordinator invokes it once `initPasswordForce` has settled.
  //
  // Deferring never loses the notice. `openNoticeIfClear` leaves it unflagged, so it returns on the
  // next load — which is the correct outcome for a notice whose whole job can wait a day.
  const _ownerPending = hasPendingLegacyMigration(getLoggedMember()?.name);

  // ── ABOUT LIGHTBOX ──────────────────────────────────────────────────────────
  const openAboutLightbox = initPaycalcAbout();

  // ── THE ? PANELS ─────────────────────────────────────────────────────────────
  // The shared Tips panel (tips-lightbox.js), opened by each card's `.help-btn[data-help]`, with the
  // content in paycalc-help.js. This page drew its own see-through glass sheet of bullet lists until
  // Nov 2026, the one `?` in the app the page showed through behind (owner-approved).
  initTipsLightbox(HELP_CONTENT, { trigger: { selector: '.help-btn[data-help]', key: 'help' } });

  // ── YTD NOTICE ──────────────────────────────────────────────────────────────
  // Shown once per device. It used to wait for the welcome lightbox; that was retired at v19.36.
  //
  // RE-POSTED 28 Aug 2026 (v21.91) for one further 90-day run, on a NEW key — see NOTICE_YTD_KEY.
  // The first run was dated 6 Apr and expired ~5 Jul, and expiry here is silent: the branch below
  // flags the device and shows nothing. So from July onwards a new starter, or anyone on a new
  // phone, got no prompt at all — at exactly the point in the tax year when entering Year-to-Date
  // figures is what makes their estimate accurate. This is a ONE-OFF restart, not a recurring
  // prompt: when this run lapses in ~Nov 2026 the honest fix is to key it off whether the member
  // has actually entered YTD figures for the current tax year, which is a different mechanism from
  // the one-time notice pattern and wants deciding on its own.
  const showYtdNotice = (function () {
    const NOTICE_DATE = YTD_NOTICE_DATE;
    const noop = () => {};
    if (isNoticeExpired(NOTICE_DATE, YTD_NOTICE_DAYS) && !lsGet(NOTICE_YTD_KEY)) { lsSet(NOTICE_YTD_KEY, '1'); return noop; }
    if (lsGet(NOTICE_YTD_KEY)) return noop;
    if (window.location.hash) return noop;   // a link opened a card — never cover it (21 Nov 2026)
    if (_ownerPending) return noop;   // data-ownership prompt takes priority this load

    const lb = document.getElementById('noticeYtdLightbox');
    if (!lb) return noop;

    const notice = createLightbox({
      overlay:  lb,
      content:  /** @type {Element|undefined} */ (document.getElementById('noticeYtdContent') ?? undefined),
      closeBtn: /** @type {Element|undefined} */ (document.getElementById('noticeYtdClose') ?? undefined),
      onClose: () => {
        archiveNotice({
          id:      'ytd_2627',
          title:   'Enter your Year to Date figures',
          section: 'Pay',
          date:    NOTICE_DATE,
          body:    'On the Pay page (☰\u00a0then 💷\u00a0Pay), open 📊\u00a0Year to Date Figures and copy the Taxable Pay and '
                 + 'Tax Paid from the Year to Date box on your latest payslip, for accurate tax estimates. Check the tax code '
                 + 'in ⚙️\u00a0Your Settings is the one at the top of the same payslip.',
        });
        lsSet(NOTICE_YTD_KEY, '1');
      },
    });

    // Handed back rather than called — the coordinator opens it after everything else has had its
    // turn. `openNoticeIfClear` is still the only way it may open (a bare `.open()` on a stacked
    // notice archives and flags a notice nobody saw — the v19.53 bug).
    return () => openNoticeIfClear(notice);
  })();

  // ── HOLIDAY PAY PREMIUM NOTICE (hpp_2526, owner 16 Nov 2026) ─────────────────────────────────────
  // SECOND IN THE PAY SEQUENCE, after the Year to Date notice above. The January 2027 payslip carries
  // the 2025/26 Holiday Pay Premium, a year this calculator holds no hours for — it did not exist yet —
  // so the card has nothing to work the premium out from, and "Last year (2025/26)" reads £–. The rough
  // estimate from Year to Date pay can still give a figure, and this notice sends the member to the
  // payslip that figure is printed on: the LAST of 2025/26, whose Year to Date box holds the whole year.
  //
  //  · It waits for the Year to Date notice, reading that one's flag as it is WIRED, so it never comes
  //    on the load the other is answered (the Calendar's FOLLOWS rule) — OR FOR THAT NOTICE'S END, at
  //    23:00 on 25 November 2026 (90 days counted across the October clock change). Its flag alone was
  //    the trap the Calendar fixed on 16 November (`FOLLOWED_ENDS`, calendar-notices.js): only the
  //    Year to Date notice's own code sets the flag on a device that never saw it, so once that code is
  //    deleted a new phone or a wiped browser would wait for ever and never get this notice.
  //  · It is for a member with a 2025/26 payslip and no figure of their own for its premium yet
  //    (`premiumStillToEstimate`). A 'none' or a 'done' keeps it shut WITHOUT flagging it: the flag
  //    is the DEVICE's, so flagging it for one member would take it from the next one signed in here.
  //  · It never opens over a card a link opened (any `#…` — the Calendar's Year to Date link, this
  //    notice's own, the backup card's), nor on the load the ownership prompt goes up.
  //  · It runs from its posting day to Friday 8 January 2027: the January payslip can be in hand from
  //    its cut-off on the 9th (`payslipMayBeInHand`), and from then the box under "Last year" takes
  //    the real figure. The start is checked too, so a clock set before it cannot raise it.
  //  · A one-off: every answer sets the flag — the ✕, the backdrop, Escape, "Not now" and the link.
  // paycalc-notice-order.test.mjs pins the dates, the order and the link to the payslip grid.
  const showHppNotice = (function () {
    const NOTICE_DATE = '16 Nov 2026';
    const STARTS      = new Date(2026, 10, 16);   // local midnight, its posting day
    const LAST_DAY    = '8 Jan 2027';             // the day before the January 2027 payslip's cut-off
    const TAX_YEAR    = '2025/26';
    const noop = () => {};
    if (Date.now() < STARTS.getTime()) return noop;
    if (isNoticeExpired(LAST_DAY, 1) && !lsGet(NOTICE_HPP_KEY)) { lsSet(NOTICE_HPP_KEY, '1'); return noop; }
    if (lsGet(NOTICE_HPP_KEY)) return noop;
    // Second in line: the Year to Date notice is still to come — unless its run has ended.
    if (!lsGet(NOTICE_YTD_KEY) && !isNoticeExpired(YTD_NOTICE_DATE, YTD_NOTICE_DAYS)) return noop;
    if (window.location.hash) return noop;     // a link opened a card — never cover it
    if (_ownerPending) return noop;            // the data-ownership prompt goes first, this load
    const ty = TAX_YEARS.find(t => t.label === TAX_YEAR);
    if (!ty || premiumStillToEstimate(ty) !== 'open') return noop;   // not theirs, or done: unflagged

    const lb = document.getElementById('noticeHppLightbox');
    if (!lb) return noop;

    const markDone = () => lsSet(NOTICE_HPP_KEY, '1');
    const notice = createLightbox({
      overlay:  lb,
      content:  /** @type {Element|undefined} */ (document.getElementById('noticeHppContent') ?? undefined),
      closeBtn: /** @type {Element|undefined} */ (document.getElementById('noticeHppClose') ?? undefined),
      // Archived as it OPENS: its link leaves the page, and a close that never runs would leave App
      // Notices without the one entry that says how to come back to this.
      onOpen: () => {
        archiveNotice({
          id:      'hpp_2526',
          title:   'Estimate your January Holiday Pay Premium',
          section: 'Pay',
          date:    NOTICE_DATE,
          body:    'This January’s Holiday Pay Premium is for the 2025/26 tax year. '
                 + 'Your 13\u00a0March\u00a02026 payslip gives a rough figure: on the Pay page (☰\u00a0then 💷\u00a0Pay), '
                 + 'choose that payslip, copy its Year to Date Taxable Pay into 📊\u00a0Year to Date Figures, then choose '
                 + 'the rough estimate in 🏖️\u00a0Holiday Pay Premium.',   // no name or date breaks
        });
      },
      onClose: markDone,
    });
    // The link leaves for the payslip by REPLACING the notice's history entry (`followLinkOutOf`, overlay.js),
    // or Back from that payslip lands on the notice's entry, which nothing answers once the page reloads.
    //
    // ALREADY ON THAT PAYSLIP, the link only names a card (App Notices review, 24 Nov 2026). From the
    // Calendar's pay jump the address is `?payday=2026-03-13` already, so the link differs by its
    // `#payslipCard` alone: `followLinkOutOf` leaves that to the browser, which does not reload, the
    // notice's Back entry closed it, and the member was left where they were with an extra dead step
    // in Back. So here the notice closes as it always does, and once that has LANDED (its history echo
    // included) the address takes the fragment in place and the card is opened as a load would open it.
    document.getElementById('noticeHppGo')?.addEventListener('click', ev => {
      const e = /** @type {MouseEvent} */ (ev);
      markDone();
      if (followLinkOutOf(notice, e)) return;
      if (e.defaultPrevented || (e.button ?? 0) !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;   // a new tab
      const href = /** @type {HTMLAnchorElement} */ (ev.currentTarget).href;
      e.preventDefault();
      notice.close().then(() => {
        history.replaceState(history.state, '', href);
        openCardNamedByHash('payslipCard', 'payslipCardBody', 'payslipCardToggle');
      });
    });
    document.getElementById('noticeHppLater')?.addEventListener('click', () => notice.close());
    return () => openNoticeIfClear(notice);
  })();

  // ONE opener for the page's notices, in their order. At most one is due on any load: the premium
  // notice reads the Year to Date notice's flag as it is wired, so it is never due on a load that
  // one opens — and were both somehow due, `openNoticeIfClear` would leave the second unflagged.
  // NONE where storage will not keep the flag (App Notices review, 24 Nov 2026): every write fails
  // silently there, so a one-time notice opened on every load (calendar-notices.js says the same).
  const showPayNotice = () => { if (!lsAvailable()) return; showYtdNotice(); showHppNotice(); };

  // ── DECIMAL HOURS CONVERTER ─────────────────────────────────────────────────
  (function () {
    const toggle = document.getElementById('decimalConverterToggle');
    const body   = document.getElementById('decimalConverterBody');
    const input  = /** @type {HTMLInputElement|null} */ (document.getElementById('decimalHrsInput'));
    const result = document.getElementById('decimalHrsResult');
    if (!toggle || !body || !input || !result) return;

    initCardCollapse('decimalConverterToggle', 'decimalConverterBody',
      'decimalConverterToggle', (/** @type {any} */ open) => { if (open) input.focus(); });

    // The reading and the words are `decimalHoursText` (paycalc-inputs.js), pure and unit-tested —
    // it reads "7,5" from a decimal-comma keypad as 7.5, which a bare parseFloat read as 7.
    function convert() {
      /** @type {HTMLElement} */ (result).textContent = decimalHoursText(/** @type {HTMLInputElement} */ (input).value);
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
  // The developer account seeds them once per device here; paycalc-app.js/-hpp.js then show the
  // actual-vs-estimate comparison from localStorage. Never visible to anybody else.
  (function () {
    if (!isActualsDev(getLoggedMember())) return;
    const trigger = document.getElementById('actualsImportBtn');
    const lb      = document.getElementById('actualsLightbox');
    if (!trigger || !lb) return;
    trigger.hidden = false;

    const input  = /** @type {HTMLTextAreaElement|null} */ (document.getElementById('actualsInput'));
    const status = document.getElementById('actualsStatus');
    // See the note in login-overlay.js — this one shadowed the shared setStatus too.
    const setActualsStatus = (/** @type {string} */ msg) => setStatus(status, msg);

    const dialog = createLightbox({
      overlay:  lb,
      content:  /** @type {Element|undefined} */ (document.getElementById('actualsContent') ?? undefined),
      closeBtn: /** @type {Element|undefined} */ (document.getElementById('actualsClose') ?? undefined),
      onOpen() {
        const stored = readPayslipActuals();
        const n = Object.keys(stored).length;
        if (input) input.value = n ? JSON.stringify(stored, null, 1) : '';
        setActualsStatus(n ? `${n} period${n !== 1 ? 's' : ''} stored on this device.`
                    : 'No actuals stored on this device.');
      },
    });

    trigger.addEventListener('click', () => dialog.open());

    document.getElementById('actualsImport')?.addEventListener('click', () => {
      const raw = (input?.value || '').trim();
      if (!raw) { setActualsStatus('Paste your JSON first.'); return; }
      let parsed;
      try { parsed = JSON.parse(raw); }
      catch { setActualsStatus('That is not valid JSON — check the text and try again.'); return; }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        setActualsStatus('Expected a JSON object keyed by payday date.'); return;
      }
      const keys = Object.keys(parsed);
      // Require the numeric fields the result display reads (gross/tax/ni/net), so a
      // malformed paste can never reach fmt(undefined) and TypeError inside calculate().
      // sl/varPay are optional (treated as absent when missing).
      const _num = ['gross', 'tax', 'ni', 'net'];
      const ok = keys.length > 0 && keys.every(k =>
        /^\d{4}-\d{2}-\d{2}$/.test(k) && parsed[k] && typeof parsed[k] === 'object' &&
        _num.every(f => typeof parsed[k][f] === 'number' && isFinite(parsed[k][f])));
      if (!ok) { setActualsStatus('Each key must be a YYYY-MM-DD date with numeric gross, tax, ni and net.'); return; }
      const n = writePayslipActuals(parsed);
      setActualsStatus(`Imported ${n} period${n !== 1 ? 's' : ''}. Reloading…`);
      window.location.reload();
    });

    document.getElementById('actualsClear')?.addEventListener('click', () => {
      clearPayslipActuals();
      setActualsStatus('Cleared. Reloading…');
      window.location.reload();
    });
  })();

  return { openAboutLightbox, showPayNotice };
}
