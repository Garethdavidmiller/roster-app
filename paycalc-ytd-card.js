// @ts-check
/**
 * paycalc-ytd-card.js — the Year to Date card's anchor on the page: its "From which payslip?"
 * select, its note and its header chip.
 *
 * Owns: whether the card holds figures (`ytdHasFigures`), refreshing the source anchor for the tax
 *   year on screen (`refreshYtdSrc` — rebuilds the select and records a source for figures that never
 *   had one), painting the note and chip from what computeTax DID (`updateYtdNote`), and the card's
 *   wiring — the two figure boxes and the "From which payslip?" select (`wireYtdCard`, 25 Nov 2026).
 * Does NOT own: the RULES — which payslip is stamped, offered, or in use (paycalc-periods.js →
 *   `ytdSourceToStamp`, `buildYtdSourceSelect`, `ytdAnchorStatus`) — or the cumulative tax itself
 *   (paycalc-calc.js). This module only carries their answers to the DOM.
 *
 * Split out of paycalc-app.js (16 Nov 2026) with the coordinator at its ratchet cap: the three read
 * the DOM and storage and nothing of the coordinator's, and one guard — "does either box hold text?"
 * — is what the stamp, the note and the chip all branch on, so it has one home. Tested by
 * paycalc-ytd-card.test.mjs.
 */

import { lsGet, lsSet } from './ls.js';
import { ytdSrcKey } from './paycalc-migrations.js';
import { taxYearForPeriod } from './paycalc-calc.js';
import {
  buildYtdSourceSelect, ytdSourceToStamp, ytdAnchorStatus, ytdSourceAfterRetype, _setSelectPeriod, viewedPeriod, YTD_SRC_EARLY,
} from './paycalc-periods.js';

/** True when either Year to Date box holds text — the one guard the anchor stamp, the note and the
 *  header chip all branch on. @returns {boolean} */
export function ytdHasFigures() {
  return ((/** @type {HTMLInputElement|null} */ (document.getElementById('ytdPay')))?.value.trim() || '') !== ''
      || ((/** @type {HTMLInputElement|null} */ (document.getElementById('ytdTax')))?.value.trim() || '') !== '';
}

/**
 * Refresh the card's source anchor for the viewed tax year: rebuild the "From which payslip?"
 * select, record a source for figures that never had one (`ytdSourceToStamp`) and select the stored
 * source. Its note and chip follow in the calculate() that every caller runs next.
 *
 * `typed` is the member typing figures in now: over `YTD_SRC_EARLY` that is a first entry again, so
 * the stamp decides afresh. A LOAD never does — filing figures typed before any payslip of the year
 * could be in hand against the first one that can is the defect the marker exists to stop.
 * @param {any} ty @param {{ typed?: boolean }} [o]
 */
export function refreshYtdSrc(ty, { typed = false } = {}) {
  const sel = /** @type {HTMLSelectElement|null} */ (document.getElementById('ytdSrcSelect'));
  if (!sel) return;
  buildYtdSourceSelect(ty);
  const stored = lsGet(ytdSrcKey(ty));
  const raw = typed && stored === YTD_SRC_EARLY ? null : stored;
  const stamp = ytdSourceToStamp(raw, ytdHasFigures(), ty);
  if (stamp != null) lsSet(ytdSrcKey(ty), String(stamp));
  const src = parseInt(String(stamp ?? raw ?? ''), 10) || 0;
  if (src) _setSelectPeriod(sel, src);
}

/**
 * The card's note and header chip for the payslip on screen (`ytdAnchorStatus`), from what computeTax
 * DID — written by calculate() on every run, so a tax code, a pair that does not fit it (`misfit`) or
 * a half-typed pair that stops the figures being used is said at once.
 * @param {any} ty @param {any} p @param {number} src @param {boolean} inUse @param {string} taxCode
 * @param {boolean} [misfit]
 */
export function updateYtdNote(ty, p, src, inUse, taxCode, misfit = false) {
  const note = document.getElementById('ytdUptoNote');
  if (!note) return;
  const s = ytdAnchorStatus({ p, ty, src, hasFigures: ytdHasFigures(), inUse, taxCode, misfit });
  note.classList.toggle('ytd-upto-note--live', s.noteLive);
  note.innerHTML = s.note;   // '' is hidden by `.ytd-upto-note:empty`
  const chip = document.getElementById('ytdStatusChip');
  if (chip) { chip.classList.toggle('ytd-status-chip--live', s.chipLive); chip.textContent = s.chip; }
}

/**
 * Wire the card's two figure boxes and its "From which payslip?" select (out of paycalc-app.js,
 * 25 Nov 2026). The coordinator injects what only it can do — persist the boxes and re-price.
 *
 * Typing figures stamps the source payslip on a first entry (the latest paid one, where the totals
 * almost always come from), and moves an older source to the payslip the take-home line names when
 * they are typed in AGAIN (`ytdSourceAfterRetype`); the select corrects either. "Again" is figures
 * already in the boxes when the edit began (`over` — the two boxes are ONE edit, so moving between
 * them does not re-read it), and never a source picked in the select this visit (`kept`): typed into
 * empty boxes, or after a pick, the figures come from the payslip the member chose, and moving it lost
 * that choice. Figures held under YTD_SRC_EARLY (entered before any payslip of the year was in hand)
 * are a first entry again when typed (`refreshYtdSrc`'s `typed`); a load never files them.
 *
 * Picking the blank placeholder UN-ANCHORS the figures: an explicit '0' is recorded, so calculate()
 * prices without them — as the note then says — and the un-anchor PERSISTS. Deleting the key instead
 * let the load-time stamp re-anchor them on the next change of payslip, as the figures remain; '0' is
 * a recorded value it leaves alone (ytdSourceToStamp).
 * @param {{ saveSettings: () => void, calculate: () => void }} deps
 */
export function wireYtdCard({ saveSettings, calculate }) {
  let over = false;
  /** The tax years whose source was picked in the select this visit. @type {Set<string>} */
  const kept = new Set();
  const onFigures = () => {
    saveSettings();
    const p  = viewedPeriod();
    const ty = taxYearForPeriod(p);
    const raw = lsGet(ytdSrcKey(ty));
    const moved = over && !kept.has(ty.label) ? ytdSourceAfterRetype(raw, { p, ty }) : null;
    if (moved != null) lsSet(ytdSrcKey(ty), String(moved));
    if (moved != null || !raw || raw === YTD_SRC_EARLY) refreshYtdSrc(ty, { typed: true });
    calculate();
  };
  for (const id of ['ytdPay', 'ytdTax']) {
    const box = document.getElementById(id);
    if (!box) continue;
    box.addEventListener('focus', e => { if (!['ytdPay', 'ytdTax'].includes(/** @type {any} */ (e).relatedTarget?.id)) over = ytdHasFigures(); });
    box.addEventListener('input', onFigures);
  }
  const sel = /** @type {HTMLSelectElement|null} */ (document.getElementById('ytdSrcSelect'));
  sel?.addEventListener('change', () => {
    const ty = taxYearForPeriod(viewedPeriod());
    kept.add(ty.label);
    lsSet(ytdSrcKey(ty), sel.value || '0');
    calculate();   // which rewrites the note and chip
  });
}
