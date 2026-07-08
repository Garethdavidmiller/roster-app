// @ts-check
/**
 * calendar-al-lightbox.js — Annual Leave lightbox and day-detail lightbox for index.html.
 *
 * Owns: AL stats fetch + display, day-detail content hydration.
 * Does NOT own: override cache (calendar-overrides.js), member selection (calendar-member.js),
 *   period arithmetic (paycalc-periods.js).
 * Edit here for: AL entitlement display, Dispatcher lieu-day breakdown, day-detail content.
 */

import { createLightbox } from './overlay.js';
import { getCurrentMember } from './calendar-member.js';
import { getDisplayYear } from './calendar-state.js';
import { db, collection, query, where, getDocs, COLLECTIONS } from './firebase-client.js';
import { getALEntitlement, isSunday, formatISO } from './roster-data.js';

/**
 * Initialise the Annual Leave lightbox and the day-detail lightbox.
 * Returns handles that the coordinator needs to pass to other modules.
 *
 * @returns {{ openDayDetail: (cell: HTMLElement) => void, closeALLightbox: () => void }}
 */
export function initCalendarLightboxes() {
  // ── ANNUAL LEAVE LIGHTBOX ───────────────────────────────────────────────────
  const lb          = document.getElementById('alLightbox');
  const takenEl     = /** @type {HTMLElement} */ (document.getElementById('alLbTaken'));
  const bookedEl    = /** @type {HTMLElement} */ (document.getElementById('alLbBooked'));
  const remEl       = /** @type {HTMLElement} */ (document.getElementById('alLbRemaining'));
  const entEl       = /** @type {HTMLElement} */ (document.getElementById('alLbEntitlement'));
  const yearEl      = /** @type {HTMLElement} */ (document.getElementById('alLbYear'));
  const breakdownEl = document.getElementById('alLbBreakdown');
  const alErrorEl   = document.getElementById('alLbError');

  const alLb = createLightbox({
    overlay:  /** @type {any} */ (lb),
    content:  /** @type {any} */ (document.getElementById('alLightboxContent')),
    closeBtn: /** @type {any} */ (document.getElementById('alLightboxClose')),
    onOpen:   () => loadALStats(),
  });

  // Generation token: a slow load for member A resolving after the user switched to member B (and
  // reopened) must not overwrite B's figures with A's. Each call takes the next gen; a stale one bails.
  let _alLoadGen = 0;
  async function loadALStats() {
    const myGen   = ++_alLoadGen;
    const member  = getCurrentMember();
    const year    = getDisplayYear();
    const yearStr = String(year);

    yearEl.textContent   = yearStr;
    takenEl.textContent  = '…';
    bookedEl.textContent = '…';
    remEl.textContent    = '…';
    remEl.className      = 'al-lb-val';   // reset a prior load's low/empty colour so the '…' placeholder isn't stale-tinted red/amber (v16.22)
    if (alErrorEl) alErrorEl.hidden = true;

    if (!member) {
      takenEl.textContent = bookedEl.textContent = remEl.textContent = entEl.textContent = '—';
      if (breakdownEl) breakdownEl.hidden = true;
      return;
    }

    entEl.textContent = '…';

    const todayStr = formatISO(new Date());
    /** @type {ReturnType<typeof setTimeout>|undefined} */
    let _alTimer;

    try {
      let taken = 0;
      let booked = 0;
      /** @type {any[]} */
      const memberOverrides = [];
      const snap = await Promise.race([
        getDocs(query(
          collection(db, COLLECTIONS.overrides),
          where('date', '>=', `${yearStr}-01-01`),
          where('date', '<=', `${yearStr}-12-31`)
        )),
        new Promise((_, reject) => { _alTimer = setTimeout(() => reject(new Error('AL load timeout')), 15_000); }),
      ]);
      if (myGen !== _alLoadGen) return;   // a newer load started while this was in flight — discard
      snap.forEach(/** @param {any} d */ d => {
        const data = d.data();
        if (data.memberName !== /** @type {any} */ (member).name) return;
        memberOverrides.push(data);
        // Rule: see CLAUDE.md — "Sundays are non-contracted" (AL entitlement count)
        if (data.type === 'annual_leave' && data.date && data.date.startsWith(yearStr) &&
            !isSunday(data.date)) {
          if (data.date <= todayStr) taken++; else booked++;
        }
      });
      const entitlement = getALEntitlement(member, year, memberOverrides);
      entEl.textContent  = String(entitlement);
      const remaining = entitlement - taken - booked;
      takenEl.textContent  = String(taken);
      bookedEl.textContent = String(booked);
      remEl.textContent    = String(remaining);
      remEl.className      = 'al-lb-val' + (remaining <= 0 ? ' empty' : remaining <= 5 ? ' low' : '');
      if (breakdownEl) {
        if (/** @type {any} */ (member).role === 'Dispatcher') {
          const lieu = entitlement - 22;
          breakdownEl.textContent = `22 base + ${lieu} BH lieu`;
          breakdownEl.hidden = false;
        } else {
          breakdownEl.hidden = true;
        }
      }
    } catch (e) {
      if (myGen !== _alLoadGen) return;   // a newer load superseded this one — don't clobber its result
      console.error('[AL lightbox] Failed:', e);
      takenEl.textContent = bookedEl.textContent = remEl.textContent = entEl.textContent = '—';
      if (breakdownEl) breakdownEl.hidden = true;
      if (alErrorEl) alErrorEl.hidden = false;
    } finally {
      // Stop the 15s timeout once the race has settled (success / error / timeout) — on the fast
      // path getDocs wins in ~1s but the timer kept running to 15s, accumulating one per open (v16.22).
      clearTimeout(_alTimer);
    }
  }

  document.getElementById('alBtn')?.addEventListener('click', () => alLb.open());

  // ── DAY DETAIL LIGHTBOX (touch tap on a calendar cell) ─────────────────────
  // Surfaces the shift time, day markers, and any override note when a staff
  // member taps a day on a touch device — the same content desktop users read
  // from the hover tooltip (which is unreachable on touch).
  const dayLb    = document.getElementById('dayDetailLightbox');
  const dateEl   = /** @type {HTMLElement} */ (document.getElementById('dayDetailDate'));
  const shiftEl  = /** @type {HTMLElement} */ (document.getElementById('dayDetailShift'));
  const extrasEl = /** @type {HTMLElement} */ (document.getElementById('dayDetailExtras'));
  const noteEl   = /** @type {HTMLElement} */ (document.getElementById('dayDetailNote'));

  const detailLb = dayLb ? createLightbox({
    overlay:  /** @type {any} */ (dayLb),
    content:  /** @type {any} */ (document.getElementById('dayDetailContent')),
    closeBtn: /** @type {any} */ (document.getElementById('dayDetailClose')),
  }) : null;

  /** @param {any} cell */
  function openDayDetail(cell) {
    if (!detailLb) return;
    const d = cell.dataset;
    dateEl.textContent  = d.detailDay   || '';
    shiftEl.textContent = d.detailShift || '';
    if (d.detailExtras) { extrasEl.textContent = d.detailExtras; extrasEl.hidden = false; }
    else                  extrasEl.hidden = true;
    if (d.detailNote)   { noteEl.textContent = `"${d.detailNote}"`; noteEl.hidden = false; }
    else                  noteEl.hidden = true;
    detailLb.open();
  }

  return { openDayDetail, closeALLightbox: alLb.close };
}
