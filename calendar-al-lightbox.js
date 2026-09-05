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
import { shiftBadgeParts } from './roster-data.js';
import { getCurrentMember } from './calendar-member.js';
import { getDisplayYear } from './calendar-state.js';
import { db, collection, query, where, getDocs, COLLECTIONS } from './firebase-client.js';
import { getALEntitlement, formatISO, paydayForCutoff } from './roster-data.js';
import { consumesEntitlement } from './al-entitlement.js';
import { shouldReplaceOverride } from './override-utils.js';
import { lsGet, lsSet } from './ls.js';

/**
 * Initialise the Annual Leave lightbox and the day-detail lightbox.
 * Returns handles that the coordinator needs to pass to other modules.
 *
 * @returns {{ openDayDetail: (cell: HTMLElement) => void, closeALLightbox: () => void }}
 */
/**
 * @param {{ navigateToPaycalc?: (paydayIso: string) => void }} [deps]
 *   navigateToPaycalc — wired to the day-detail "View pay estimate" button on pay-marked days.
 */
export function initCalendarLightboxes({ navigateToPaycalc } = {}) {
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
    content:  /** @type {HTMLElement} */ (document.getElementById('alLightboxContent')),
    closeBtn: /** @type {HTMLElement} */ (document.getElementById('alLightboxClose')),
    onOpen:   () => loadALStats(),
  });

  // Last-known-good stats memo, per member+year (v18.23 — "AL stats quite slow to load"). A
  // one-shot getDocs is SERVER-first in the Firestore SDK (the persistent cache is only its
  // offline fallback), so every open previously sat on '…' for a full network round-trip.
  // Rendering the previous successful result instantly — then refreshing it from the (now
  // member-narrowed) server query — is the app's stale-while-revalidate/last-good pattern
  // (team view keeps its last-good grid the same way). Module-local key: not in storage-keys.js
  // (that file is only for keys shared across files).
  /** @param {string} name @param {string|number} year */
  const _alMemoKey = (name, year) => `myb_al_stats_${name}|${year}`;

  /** Paint the four figures + breakdown. One renderer for the memo and fresh paths so they
   *  can never drift. @param {{ taken:number, booked:number, entitlement:number, breakdown:string|null }} s */
  function renderALStats(s) {
    const remaining = s.entitlement - s.taken - s.booked;
    entEl.textContent    = String(s.entitlement);
    takenEl.textContent  = String(s.taken);
    bookedEl.textContent = String(s.booked);
    remEl.textContent    = String(remaining);
    remEl.className      = 'al-lb-val' + (remaining <= 0 ? ' empty' : remaining <= 5 ? ' low' : '');
    if (breakdownEl) {
      breakdownEl.textContent = s.breakdown ?? '';
      breakdownEl.hidden = s.breakdown == null;
    }
  }

  // Generation token: a slow load for member A resolving after the user switched to member B (and
  // reopened) must not overwrite B's figures with A's. Each call takes the next gen; a stale one bails.
  let _alLoadGen = 0;
  async function loadALStats() {
    const myGen   = ++_alLoadGen;
    const member  = getCurrentMember();
    const year    = getDisplayYear();
    const yearStr = String(year);

    yearEl.textContent = yearStr;
    if (alErrorEl) alErrorEl.hidden = true;

    if (!member) {
      takenEl.textContent = bookedEl.textContent = remEl.textContent = entEl.textContent = '—';
      remEl.className = 'al-lb-val';
      if (breakdownEl) breakdownEl.hidden = true;
      return;
    }

    // Instant paint from the last successful load (if any) while the refresh runs; else the
    // '…' placeholders as before. A malformed memo falls through to placeholders.
    /** @type {any} */
    let memo = null;
    try { memo = JSON.parse(lsGet(_alMemoKey(/** @type {any} */ (member).name, yearStr)) || 'null'); } catch { /* placeholder path */ }
    const memoShown = !!(memo && Number.isFinite(memo.taken) && Number.isFinite(memo.booked) && Number.isFinite(memo.entitlement));
    if (memoShown) {
      renderALStats(memo);
    } else {
      takenEl.textContent  = '…';
      bookedEl.textContent = '…';
      remEl.textContent    = '…';
      remEl.className      = 'al-lb-val';   // reset a prior load's low/empty colour so the '…' placeholder isn't stale-tinted red/amber (v16.22)
      entEl.textContent    = '…';
      if (breakdownEl) breakdownEl.hidden = true;
    }

    const todayStr = formatISO(new Date());
    /** @type {ReturnType<typeof setTimeout>|undefined} */
    let _alTimer;

    try {
      let taken = 0;
      let booked = 0;
      /** @type {any[]} */
      const memberOverrides = [];
      const snap = await Promise.race([
        // Narrowed to THIS member (v18.23): the old date-range-only query downloaded the whole
        // year of overrides for EVERY member on each open, then filtered client-side — the main
        // slow-load cause. The (memberName ASC, date ASC) composite index this shape needs is
        // declared in firestore.indexes.json and deployed by deploy-rules.yml.
        getDocs(query(
          collection(db, COLLECTIONS.overrides),
          where('memberName', '==', /** @type {any} */ (member).name),
          where('date', '>=', `${yearStr}-01-01`),
          where('date', '<=', `${yearStr}-12-31`)
        )),
        new Promise((_, reject) => { _alTimer = setTimeout(() => reject(new Error('AL load timeout')), 15_000); }),
      ]);
      if (myGen !== _alLoadGen) return;   // a newer load started while this was in flight — discard
      // Resolve ONE winner per date before counting (v16.23) — every other consumer applies
      // shouldReplaceOverride, but this loop counted every DOC: a superseded/duplicate AL doc
      // sharing a date with a winning non-AL override (two-device race, offline retry, legacy
      // data) counted as a day taken and UNDERSTATED remaining AL.
      /** @type {Map<string, any>} */
      const byDate = new Map();
      snap.forEach(/** @param {any} d */ d => {
        const data = d.data();
        if (data.memberName !== /** @type {any} */ (member).name) return;
        memberOverrides.push(data);
        const ex = byDate.get(data.date);
        if (!ex || shouldReplaceOverride(ex, data)) byDate.set(data.date, data);
      });
      for (const [date, ov] of byDate) {
        // Which days consume entitlement is ONE question with one answer, in al-entitlement.js
        // (v21.46). This surface used to carry its own version — Sunday and start-date, but no
        // rest-day test — so a member's own balance here could differ from the figure the Admin
        // banner and the save-time cap were working from.
        if (ov.type === 'annual_leave' && date && date.startsWith(yearStr)
            && consumesEntitlement(member, date, byDate)) {
          if (date <= todayStr) taken++; else booked++;
        }
      }
      const entitlement = getALEntitlement(member, year, memberOverrides);
      // NO ENTITLEMENT ON RECORD → the em-dash state this panel already uses for "no member"
      // (v22.45). Unreachable from the calendar (a Management account is excluded from the member
      // selector), but `renderALStats` would otherwise do `null - taken - booked` and paint a
      // NEGATIVE remaining as confidently as a real one — null coerces to 0, so the arithmetic
      // that looks like it would fail loudly instead succeeds quietly.
      if (entitlement === null) {
        takenEl.textContent = bookedEl.textContent = remEl.textContent = entEl.textContent = '—';
        remEl.className = 'al-lb-val';
        if (breakdownEl) breakdownEl.hidden = true;
        return;
      }
      // getALEntitlement returns proRatedAL[year] BEFORE the Dispatcher branch, so a pro-rated
      // dispatcher's entitlement is NOT 22+lieu — the "22 base + N lieu" split would show a
      // negative lieu figure (e.g. "22 base + -10 BH lieu"). Hide the breakdown for a pro-rated
      // joining year; it applies again from their first full year (v16.69 review fix).
      const _proRated = /** @type {any} */ (member).proRatedAL?.[year] !== undefined;
      const breakdown = (/** @type {any} */ (member).role === 'Dispatcher' && !_proRated)
        ? `22 base + ${entitlement - 22} BH lieu` : null;
      const fresh = { taken, booked, entitlement, breakdown };
      renderALStats(fresh);
      // Persist the last-known-good memo so the NEXT open paints instantly (best-effort).
      lsSet(_alMemoKey(/** @type {any} */ (member).name, yearStr), JSON.stringify(fresh));
    } catch (e) {
      if (myGen !== _alLoadGen) return;   // a newer load superseded this one — don't clobber its result
      // Memo already on screen → keep the last-good figures silently (the team-view failure
      // model: no partial/blank clobber, minimal noise) and log for the developer. No memo →
      // the original visible error state.
      if (memoShown) { console.warn('[AL lightbox] Refresh failed — keeping last-good stats:', e); return; }
      console.error('[AL lightbox] Failed:', e);
      takenEl.textContent = bookedEl.textContent = remEl.textContent = entEl.textContent = '—';
      remEl.className = 'al-lb-val';
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
  // Surfaces the shift time, what it was changed from, and the day markers when a staff
  // member taps a day on a touch device — the same content desktop users read
  // from the hover tooltip (which is unreachable on touch).
  const dayLb    = document.getElementById('dayDetailLightbox');
  const dateEl   = /** @type {HTMLElement} */ (document.getElementById('dayDetailDate'));
  const weekEl   = /** @type {HTMLElement} */ (document.getElementById('dayDetailWeek'));
  const asRostEl = /** @type {HTMLElement} */ (document.getElementById('dayDetailAsRostered'));
  const glyphEl  = /** @type {HTMLElement} */ (document.getElementById('dayDetailShiftGlyph'));
  const wordsEl  = /** @type {HTMLElement} */ (document.getElementById('dayDetailShiftWords'));
  const timeEl   = /** @type {HTMLElement} */ (document.getElementById('dayDetailShiftTime'));
  const changeEl = /** @type {HTMLElement} */ (document.getElementById('dayDetailChange'));
  const pairEl   = /** @type {HTMLElement} */ (document.getElementById('dayDetailChangePair'));
  const byEl     = /** @type {HTMLElement} */ (document.getElementById('dayDetailBy'));
  const extrasEl = /** @type {HTMLElement} */ (document.getElementById('dayDetailExtras'));
  const payBtn   = /** @type {HTMLButtonElement|null} */ (document.getElementById('dayDetailPayBtn'));

  /**
   * One shift badge, built as elements. Same class, emoji and word as every other badge in the app.
   * @param {string} shift @returns {HTMLElement}
   */
  function _badge(shift) {
    const { cls, emoji, word, timed } = shiftBadgeParts(shift);
    // A TIMED shift shows its time, not its kind. Both sides of a time tweak classify the same way
    // — 06:20 and 06:30 are both "Early" — so the kind alone drew `☀️ EARLY → ☀️ EARLY`, two
    // identical pills either side of an arrow, on what is probably the commonest change there is.
    // The kind is still carried by the colour, the emoji and the accessible label.
    const body = timed ? shift : word;
    const el = document.createElement('span');
    // `ddc-badge` and NOT `shift-badge`: index.css owns `.shift-badge` for CALENDAR CELLS and
    // retunes it at six breakpoints (down to 7px type and `min-width: 80%`), so reusing it here
    // rendered a full-width block with the emoji stacked above the word. The COLOUR classes are
    // colour-only and live in shared.css, so the panel takes those and brings its own pill.
    el.className = `ddc-badge ${cls}`;
    const ic = document.createElement('span');
    ic.setAttribute('aria-hidden', 'true');
    ic.textContent = emoji;
    const tx = document.createElement('span');
    tx.textContent = body;
    if (timed) el.setAttribute('aria-label', `${word} shift, ${shift.replace('-', ' to ')}`);
    el.append(ic, tx);
    return el;
  }


  const detailLb = dayLb ? createLightbox({
    overlay:  /** @type {any} */ (dayLb),
    content:  /** @type {HTMLElement} */ (document.getElementById('dayDetailContent')),
    closeBtn: /** @type {HTMLElement} */ (document.getElementById('dayDetailClose')),
  }) : null;

  /** @param {any} cell */
  function openDayDetail(cell) {
    if (!detailLb) return;
    const d = cell.dataset;
    dateEl.textContent  = d.detailDay   || '';
    // The roster week for THIS date, or nothing. Which members have one is `weekContext`'s call in
    // the renderer, so the panel never has to know which rosters rotate.
    if (weekEl) {
      weekEl.textContent = d.detailWeek || '';
      weekEl.hidden = !d.detailWeek;
    }
    // The words and the TIME are separate spans so a 320px wrap breaks between them and never
    // inside the value — `splitShiftLine` in calendar-renderer.js owns the split. A dataset written
    // by an older renderer (a page held open across a deploy) has neither, so fall back to the
    // whole line rather than rendering an empty headline.
    wordsEl.textContent = d.detailShiftWords || d.detailShift || '';
    if (timeEl) {
      timeEl.textContent = d.detailShiftTime || '';
      timeEl.hidden = !d.detailShiftTime;
    }
    // THE DAY'S OWN KIND GLYPH (v22.70) — the same emoji as the cell that was tapped, from the one
    // badge authority. Before this the panel was monochrome unless something had CHANGED, so the
    // colour and the glyph read as properties of a change rather than of the shift; a plain Late
    // turn and a plain Rest day were the same grey card with different words.
    const kindEmoji = d.detailShiftValue ? shiftBadgeParts(d.detailShiftValue).emoji : '';
    if (glyphEl) {
      glyphEl.textContent = kindEmoji;
      glyphEl.hidden = !kindEmoji;
    }
    // THE CHANGE, AS THE TWO BADGES THE MEMBER ALREADY READS IN THE GRID. Present only when an
    // override actually changed the day, so its absence is not a claim that nothing changed — it is
    // the renderer having found the two values equal.
    //
    // Built as real elements with `textContent`, never `innerHTML`: `getShiftBadge` returns markup
    // and the obvious shortcut is to stash that in the dataset and write it in, which is how a
    // `data-` attribute becomes an injection surface. The parts come from the same function that
    // builds every other badge in the app, so a shift cannot be one colour in the cell and another
    // in the panel.
    if (changeEl && pairEl) {
      const from = d.detailBaseShift, to = d.detailNowShift;
      if (from && to) {
        // THE ARROW TRAVELS WITH THE BADGE IT POINTS AT. The pair wraps at 320px, and with three
        // loose flex children the wrap fell after the arrow — "08:00-16:30 →" on one line and
        // "07:00-16:00" on the next, which reads as a sentence that lost its end. Grouped, the
        // wrap puts "→ 07:00-16:00" on line two, where the arrow leads the continuation. Identical
        // rendering when it does not wrap.
        const to_ = document.createElement('span');
        to_.className = 'ddc-to';
        to_.append(
          Object.assign(document.createElement('span'),
            { className: 'ddc-arrow', textContent: '→', ariaHidden: 'true' }),
          _badge(to),
        );
        pairEl.replaceChildren(_badge(from), to_);
        // ONE sentence for a screen reader. The badges are decorative here — read individually
        // they would be "Spare, right arrow, Early", which is three fragments of one fact, and the
        // arrow is not a word. The headline above still states the shift in full.
        if (byEl) {
          if (d.detailBy) { byEl.textContent = d.detailBy; byEl.hidden = false; }
          else              byEl.hidden = true;
        }
        // The provenance joins the SENTENCE rather than being read after it, so a screen reader
        // gets one fact and not two fragments.
        // Same correction as the eyebrow: it is the BASE ROSTER on the left, not the previous
        // value, so the sentence leads with what that badge actually is.
        changeEl.setAttribute('aria-label',
          `Base roster ${d.detailBase}, changed to ${d.detailShift || ''}`.trim()
          + (d.detailBy ? `. ${d.detailBy}` : ''));
        changeEl.hidden = false;
      } else {
        changeEl.hidden = true;
        changeEl.removeAttribute('aria-label');
      }
    }
    // "As rostered" — the change block's other state, and ONLY where the renderer could see that a
    // server read had settled for the month. Its ABSENCE is therefore not the opposite claim: on a
    // last-known-good month neither line renders, which is the honest state (calendar-data-state.js).
    // The `!d.detailBaseShift` half guards a dataset written by an OLDER renderer — a page held
    // open across a deploy — where both flags could be present at once.
    if (asRostEl) asRostEl.hidden = !(d.detailAsRostered && !d.detailBaseShift);
    // THE DAY MARKERS, AS THE CALENDAR'S OWN ICONS (v22.70). `detailMarkers` is the structured
    // form of the same list the tooltip's comma sentence comes from, so the two cannot name
    // different days. The parse is guarded and falls back to the sentence: a chip row is a nicety,
    // and losing the FACT because a data attribute would not parse is not a trade worth making.
    let markers;
    try { markers = d.detailMarkers ? JSON.parse(d.detailMarkers) : []; } catch { markers = []; }
    if (markers.length) {
      extrasEl.replaceChildren(...markers.map(/** @param {{icon?:string,label?:string}} m */ (m) => {
        const chip = document.createElement('span');
        chip.className = 'ddm-chip';
        const ic = document.createElement('span');
        ic.className = 'ddm-icon';
        ic.setAttribute('aria-hidden', 'true');
        ic.textContent = m.icon || '';
        const tx = document.createElement('span');
        tx.textContent = m.label || '';
        chip.append(ic, tx);
        return chip;
      }));
      extrasEl.hidden = false;
    } else if (d.detailExtras) {
      extrasEl.textContent = d.detailExtras;
      extrasEl.hidden = false;
    } else {
      extrasEl.hidden = true;
    }
    // Pay-marked day (payday or cut-off): offer an explicit route to the calculator. Touch has no
    // hover, so tapping such a day used to teleport to paycalc unexpectedly — now the jump is a
    // deliberate button inside the detail. A cut-off day resolves to its own payday.
    const payTarget = d.paydayIso || (d.cutoffIso ? paydayForCutoff(d.cutoffIso) : null);
    if (payBtn) {
      if (payTarget && navigateToPaycalc) {
        payBtn.hidden = false;
        payBtn.onclick = () => { detailLb.close(); navigateToPaycalc(payTarget); };
      } else {
        payBtn.hidden = true;
        payBtn.onclick = null;
      }
    }
    detailLb.open();
  }

  return { openDayDetail, closeALLightbox: alLb.close };
}
