// @ts-check
/**
 * paycalc-roster-hint.js — Roster-assist hint bar UI for paycalc.html.
 *
 * Owns: updateRosterHint, updateJoinerNotice, toggleRosterDays, fillFromRoster,
 *   fillCategoryFromRoster, _applyRosterSuggestion, clearRosterSuggestedAll,
 *   _restoreRosterSuggested, snapKey, renderRosterDayList.
 * Does NOT own: period arithmetic (paycalc-periods.js), override cache / suggestion
 *   engine (paycalc-roster-suggestions.js), calculation (paycalc-app.js).
 * Edit here for: roster hint bar rendering, day list, fill logic, snap persistence.
 * Do not edit here for: pay maths, period date maths, override fetch scheduling.
 */

import { getPeriods, currentPeriodNum } from './paycalc-periods.js';
import { getLoggedMember, getEffectiveContr, getContr } from './paycalc-settings.js';
import { getRosterSuggestion, getOverridesFetchState, fetchOverridesForPeriod } from './paycalc-roster-suggestions.js';
import { escapeHtml } from './roster-data.js';
import { lsGet, lsSet } from './ls.js';
import { pcPrefix } from './paycalc-migrations.js';
import { fdLong } from './paycalc-format.js';

import { setStatus } from './status-text.js';
// The seven special-rate categories and their hour/minute field ids — the ONE source for the
// pairing that was hand-duplicated across _restoreRosterSuggested / _applyRosterSuggestion /
// fillCategoryFromRoster here and the two field lists in paycalc-app.js. A suggestion/snapshot
// object stores each value under its H/M field id, so the value is `source[hId]` / `source[mId]`.
// (hId is `cat + 'H'`, mId is `cat + 'M'`; kept explicit for grep-ability.)
// HM_PAIRS moved to paycalc-format.js at v22.06 (paycalc-fill-year.js needs it and this module's
// import chain reaches the gstatic SDK, so it cannot load in Node). Re-exported here so every
// existing importer is untouched.
export { HM_PAIRS } from './paycalc-format.js';
import { HM_PAIRS } from './paycalc-format.js';

// ── RENDER CACHE ──────────────────────────────────────────────────────────────
// Avoids the parse+layout cost of innerHTML when the rendered string is identical
// (e.g. period change → multiple upstream calls with no change in field values).
/** @type {any} */ let _lastRosterRowsHtml = null;

/**
 * Formats hours+minutes as a compact string: "7h 30m", "7h", or "30m".
 * @param {any} h
 * @param {any} m
 */
function fmtH(h, m) {
  if (h && m) return `${h}h ${m}m`;
  if (h)      return `${h}h`;
  return `${m}m`;
}

/**
 * Maps a suggestion category to a confidence badge descriptor.
 * Returns null for base-roster rows — no badge needed when the source is the
 * scheduled rota. Badges only appear when the source or certainty is non-obvious.
 * @param {any} cat
 * @param {any} fromOv
 */
function _confBadge(cat, fromOv, hasEstimate = false) {
  // A defaulted Other rest-day means this bucket's figure INCLUDES an 8h guess — never let the
  // row claim "Recorded change"/"Possible overtime" for a number that is an estimate the member
  // must correct. The default routes by day (Boxing → box, BH → bhOt, else rdw), so the flag is
  // PER BUCKET and follows the minutes.
  if (hasEstimate)                    return { text: 'Includes an 8h estimate — check', cls: 'conf-possible' };
  if (cat === 'ot' || cat === 'bhOt') return { text: 'Possible overtime', cls: 'conf-possible' };
  if (cat === 'rdw' || fromOv)        return { text: 'Recorded change',   cls: 'conf-recorded' };
  return null;
}

const _DAY_ABBS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const _MON_ABBS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const _DAY_CHIP_LABELS = {
  sat: 'Rostered Sat', sun: 'Sunday', bh: 'Bank holiday',
  bhOt: 'Bank holiday overtime', ot: 'Overtime', box: 'Boxing Day', rdw: 'RDW',
};

/**
 * Populates the collapsible day list with the individual shifts behind the suggestion.
 * @param {any} days
 */
function renderRosterDayList(days) {
  const list = document.getElementById('rosterDayList');
  if (!list) return;
  if (!days || !days.length) { list.innerHTML = ''; return; }
  list.innerHTML = days.map(/** @param {any} d */ d => {
    const dt      = d.date;
    const dateStr = `${_DAY_ABBS[dt.getDay()]} ${dt.getDate()} ${_MON_ABBS[dt.getMonth()]}`;
    const chipLabel = (/** @type {Record<string, any>} */ (_DAY_CHIP_LABELS))[d.type] || '';
    return `<div class="roster-day-row">` +
      `<span class="roster-day-date">${dateStr}</span>` +
      `<span class="roster-day-shift">${escapeHtml(d.shift)}</span>` +
      (chipLabel ? `<span class="roster-day-chip roster-day-chip--${d.type}">${chipLabel}</span>` : '') +
      `</div>`;
  }).join('');
}

/**
 * Fills a single H/M field pair if currently blank (or previously roster-filled).
 * @param {any} hId
 * @param {any} mId
 * @param {any} hVal
 * @param {any} mVal
 */
function _suggestIfBlank(hId, mId, hVal, mVal) {
  const elH = /** @type {HTMLInputElement} */ (document.getElementById(hId));
  const elM = /** @type {HTMLInputElement} */ (document.getElementById(mId));
  if (!elH || !elM) return;
  // Nothing to suggest when the engine reports zero for BOTH hours and minutes — the
  // suggestion object uses numeric 0 (not null) for undetected categories, so guarding
  // only on `== null` stamped a gold "0" onto every empty category, making it look like a
  // confirmed "none" where the engine actually has no information. A real 0-in-one-field
  // pairing (e.g. 5h 0m, or 0h 30m) still passes because the other field is non-zero.
  if ((hVal == null || hVal === 0) && (mVal == null || mVal === 0)) return;
  // Treat H and M independently — a manually-edited field is skipped individually
  // rather than blocking its paired field.
  const hEdited = elH.value !== '' && !elH.classList.contains('roster-suggested');
  const mEdited = elM.value !== '' && !elM.classList.contains('roster-suggested');
  if (!hEdited && hVal != null) {
    elH.value = hVal ?? '';
    elH.classList.add('roster-suggested');
  }
  if (!mEdited && mVal != null) {
    elM.value = mVal ?? '';
    elM.classList.add('roster-suggested');
  }
}

// ── SNAP PERSISTENCE ──────────────────────────────────────────────────────────

/**
 * Per-period localStorage key for the last roster snapshot used for auto-fill.
 * @param {any} pNum
 */
export const snapKey = pNum => `${pcPrefix()}snap_${pNum}`;

/**
 * Saves the suggestion values that were just applied so that loadPeriodData can restore
 * the roster-suggested class on those fields after a page reload.
 * @param {any} pNum
 * @param {any} s
 */
function _saveRosterSnap(pNum, s) {
  try {
    lsSet(snapKey(pNum), JSON.stringify({
      satH: s.satH, satM: s.satM, sunH: s.sunH, sunM: s.sunM,
      bhH: s.bhH, bhM: s.bhM, bhOtH: s.bhOtH, bhOtM: s.bhOtM,
      otH: s.otH, otM: s.otM, rdwH: s.rdwH, rdwM: s.rdwM,
      boxH: s.boxH, boxM: s.boxM,
    }));
  } catch {}
}

/** Re-adds roster-suggested to any field whose current value still matches the last
 *  roster snapshot. Called immediately after writeFormData in loadPeriodData so that
 *  _suggestIfBlank can update those fields when Firestore returns new data.
 * @param {any} pNum
 */
export function _restoreRosterSuggested(pNum) {
  let snap;
  try { const raw = lsGet(snapKey(pNum)); if (raw) snap = JSON.parse(raw); } catch {}
  if (!snap) return;
  for (const { hId, mId } of HM_PAIRS) {
    const hVal = snap[hId], mVal = snap[mId];
    const elH = /** @type {HTMLInputElement} */ (document.getElementById(hId));
    const elM = /** @type {HTMLInputElement} */ (document.getElementById(mId));
    if (!elH || !elM) continue;
    // `hVal != null` (not `hVal ||`): a snapped value of 0 is a REAL roster suggestion (e.g. the
    // hours half of a 0h30m fill) — coercing it to '' dropped the gold highlight on reload and made
    // the field read as hand-edited, blocking future re-fills (review finding).
    if (elH.value === (hVal != null ? String(hVal) : '')) elH.classList.add('roster-suggested');
    if (elM.value === (mVal != null ? String(mVal) : '')) elM.classList.add('roster-suggested');
  }
}

// ── ROSTER HINT BAR ───────────────────────────────────────────────────────────

/** Render the roster hint bar for the currently selected period. */
export function updateRosterHint() {
  const card = document.getElementById('rosterHintBar');
  if (!card) return;

  const p = getPeriods().find(/** @param {any} x */ x => x.num === currentPeriodNum());
  if (!p) { card.style.display = 'none'; return; }

  const s = /** @type {any} */ (getRosterSuggestion(p, getLoggedMember()));
  if (!s) { card.style.display = 'none'; return; }

  const badge = document.getElementById('rosterStateBadge');
  if (badge) {
    if (getOverridesFetchState() === 'loaded') {
      setStatus(badge, '✓ Includes recorded changes');
      badge.className    = 'roster-state-badge loaded';
    } else if (getOverridesFetchState() === 'base-only') {
      setStatus(badge, '⚠ Scheduled only');
      badge.className    = 'roster-state-badge base-only';
    } else {
      badge.textContent  = '';
      badge.className    = 'roster-state-badge';
    }
  }

  const rows = document.getElementById('rosterRows');
  if (rows) {
    const cats = [
      { cat: 'sat',  icon: '🗓️', label: 'Rostered Sat',           h: s.satH,  m: s.satM,  count: s.satCount,  fromOv: s.satFromOv },
      { cat: 'sun',  icon: '☀️', label: 'Sunday',                h: s.sunH,  m: s.sunM,  count: s.sunCount,  fromOv: s.sunFromOv },
      { cat: 'bh',   icon: '🏦', label: 'Bank holiday',          h: s.bhH,   m: s.bhM,   count: s.bhCount,   fromOv: s.bhFromOv  },
      { cat: 'bhOt', icon: '🏦', label: 'Bank holiday overtime', h: s.bhOtH, m: s.bhOtM, count: s.bhOtCount, fromOv: true        },
      { cat: 'ot',   icon: '⏰', label: 'Overtime',             h: s.otH,   m: s.otM,   count: s.otCount,   fromOv: true        },
      { cat: 'rdw',  icon: '💼', label: 'RDW',                  h: s.rdwH,  m: s.rdwM,  count: s.rdwCount,  fromOv: true        },
      { cat: 'box',  icon: '🎁', label: 'Boxing Day',           h: s.boxH,  m: s.boxM,  count: s.boxCount,  fromOv: s.boxFromOv },
    ].filter(r => r.count > 0);

    const html = cats.map(r => {
      const suggestMins = r.h * 60 + r.m;
      const dayStr = r.count === 1 ? '1 day' : `${r.count} days`;

      const elH = /** @type {HTMLInputElement} */ (document.getElementById(r.cat + 'H'));
      const elM = /** @type {HTMLInputElement} */ (document.getElementById(r.cat + 'M'));
      const hv = elH?.value.trim() ?? '';
      const mv = elM?.value.trim() ?? '';
      const enteredMins = (hv === '' && mv === '') ? null
        : (parseInt(hv) || 0) * 60 + (parseInt(mv) || 0);

      const conf     = _confBadge(r.cat, r.fromOv, !!(s.defaulted8h && s.defaulted8h[r.cat]));
      const confHtml = conf ? `<span class="conf-badge ${conf.cls}">${conf.text}</span>` : '';

      let rowClass, totalText, metaText, arrowHtml, ariaLabel;
      if (enteredMins === null) {
        rowClass  = 'roster-row';
        totalText = fmtH(r.h, r.m);
        metaText  = confHtml ? `${dayStr} · ${confHtml}` : dayStr;
        arrowHtml = `<span class="roster-cat-arrow" aria-hidden="true">→</span>`;
        ariaLabel = `Fill ${r.label} hours from your calendar`;
      } else if (enteredMins === suggestMins) {
        rowClass  = 'roster-row roster-row--matched';
        totalText = fmtH(r.h, r.m);
        metaText  = dayStr;
        arrowHtml = `<span class="roster-cat-match" aria-hidden="true">✓</span>`;
        ariaLabel = `${r.label} matches your calendar: ${fmtH(r.h, r.m)}`;
      } else {
        const entH = Math.floor(enteredMins / 60), entM = enteredMins % 60;
        rowClass  = 'roster-row roster-row--differs';
        totalText = `${fmtH(entH, entM)} entered`;
        metaText  = confHtml ? `Calendar: ${fmtH(r.h, r.m)} · ${confHtml}` : `Calendar: ${fmtH(r.h, r.m)}`;
        arrowHtml = `<span class="roster-cat-arrow roster-cat-arrow--differs" aria-hidden="true">→</span>`;
        ariaLabel = `${r.label}: you have ${fmtH(entH, entM)}, your calendar says ${fmtH(r.h, r.m)}. Tap to use calendar values`;
      }

      return `<button class="${rowClass}" type="button" data-cat="${r.cat}" ` +
          `aria-label="${ariaLabel}">` +
        `<span class="roster-row-icon" aria-hidden="true">${r.icon}</span>` +
        `<span class="roster-row-label">${r.label}</span>` +
        `<span class="roster-row-total">${totalText}</span>` +
        `<span class="roster-row-meta">${metaText}</span>` +
        arrowHtml +
        `</button>`;
    }).join('');
    if (html !== _lastRosterRowsHtml) {
      rows.innerHTML = html;
      _lastRosterRowsHtml = html;
    }
  }

  const hintTextEl = document.getElementById('rosterHintText');
  if (hintTextEl) {
    hintTextEl.textContent = getOverridesFetchState() === 'loaded'
      ? 'Likely special-rate hours only — Saturday, Sunday, bank holidays, RDW, and Boxing Day. Standard contracted hours are already included in basic pay. Check against what you actually worked.'
      : 'Calendar (base pattern only) — recorded shift changes not yet loaded. Special-rate hours only; standard contracted hours are already included in basic pay.';
  }

  const fillBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById('fillFromRosterBtn'));
  if (fillBtn) {
    // Nothing fillable → the button says so and refuses, instead of sitting enabled over an
    // empty list and doing nothing when tapped (v21.67). An enabled control that no-ops is
    // indistinguishable from a broken one — which is how it was reported.
    //
    // But "nothing to fill" is not the same as "nothing to DO", and reading it as such disabled
    // the button in the two states it is most needed (v21.77):
    //
    //   1. There is something to CLEAR. The reported case was a bank holiday taken off the roster
    //      leaving a stale 7h — the calendar's answer is zero for every category, so `fillable` is
    //      false, so the button that exists to remove it was greyed out and she still "had to do
    //      it manually". v21.68 fixed the clearing and v21.67 locked the door in front of it, in
    //      the same day's work and the same reported scenario.
    //   2. The recorded shift changes have NOT loaded. Then zero is not the calendar's answer, it
    //      is the absence of one — and a disabled "Nothing to fill this payslip" states a fact the
    //      app has not established. It also makes the tap-retries-the-fetch recovery unreachable
    //      in exactly the state that recovery was written for.
    //
    // So: refuse only when the data is complete AND there is nothing to write AND nothing to remove.
    const _loaded = getOverridesFetchState() === 'loaded';
    const _entered = (/** @type {string} */ cat) => {
      const h = /** @type {HTMLInputElement} */ (document.getElementById(cat + 'H'))?.value.trim() ?? '';
      const m = /** @type {HTMLInputElement} */ (document.getElementById(cat + 'M'))?.value.trim() ?? '';
      return h !== '' || m !== '';
    };
    const _zeroInCalendar = (/** @type {string} */ cat) =>
      !((s[cat + 'H'] || 0) > 0 || (s[cat + 'M'] || 0) > 0);
    const fillable = ['sat', 'sun', 'bh', 'bhOt', 'ot', 'rdw', 'box'].some(cat => !_zeroInCalendar(cat));
    // Only the categories a Replace may actually clear count as work to do — the same set the
    // clear itself is scoped to, so the button can never promise a removal that will not happen.
    const clearable = _loaded && [...CLEARABLE_CATS].some(cat => _entered(cat) && _zeroInCalendar(cat));
    const hasEntries = ['sat', 'sun', 'bh', 'bhOt', 'ot', 'rdw', 'box'].some(_entered);
    fillBtn.disabled = _loaded && !fillable && !clearable;
    fillBtn.textContent = fillBtn.disabled ? 'Nothing to fill this payslip'
      : hasEntries ? 'Replace with calendar values' : 'Fill from calendar';
  }

  const daysToggle = document.getElementById('rosterDaysToggle');
  if (daysToggle) daysToggle.style.display = s.days.length ? '' : 'none';
  renderRosterDayList(s.days);
  card.style.display = '';
}

/**
 * Show (or hide) a notice when the logged-in member started mid-period,
 * explaining that their contracted hours have been pro-rated.
 * @param {any} p - Current period object.
 */
export function updateJoinerNotice(p) {
  const el = document.getElementById('joinerNotice');
  if (!el || !p) return;
  const member = getLoggedMember();
  if (!member?.startDate || member.startDate <= p.start || member?.noProRate) { el.style.display = 'none'; return; }
  if (member.startDate > p.cutoff) { el.style.display = 'none'; return; }
  const msPerDay     = 86400000;
  const daysEmployed = Math.round((+p.cutoff - +member.startDate) / msPerDay) + 1;
  const totalDays    = Math.round((+p.cutoff - +p.start) / msPerDay) + 1;
  const proRated     = getEffectiveContr(p);
  const base         = getContr();
  const startFmt     = fdLong(member.startDate);
  el.textContent = `📅 You joined on ${startFmt}. For this period: contracted hours ${proRated} of ${base}, London Allowance and pension contribution scaled to ${daysEmployed} of ${totalDays} days.`;
  el.style.display = '';
}

/** Toggles the day list open/closed. */
export function toggleRosterDays() {
  const list = document.getElementById('rosterDayList');
  const btn  = document.getElementById('rosterDaysToggle');
  if (!list || !btn) return;
  const opening = list.style.display === 'none';
  list.style.display = opening ? '' : 'none';
  btn.textContent    = opening ? 'Hide days ▲' : 'Show days ▼';
}

/** Removes the roster-suggested highlight from all hour input fields. */
export function clearRosterSuggestedAll() {
  document.querySelectorAll('.hhmm-field input.roster-suggested')
    .forEach(el => el.classList.remove('roster-suggested'));
}

// ── FILL LOGIC ────────────────────────────────────────────────────────────────

/**
 * Applies a suggestion object to all H/M field pairs.
 * force=false (default): skips fields already manually entered.
 * force=true: overwrites all fields — used by the "Replace with calendar values" button.
 * @param {any} s
 * @param {boolean} [force]
 */
export function _applyRosterSuggestion(s, force = false, { clearZeros = false } = {}) {
  // Count what was actually WRITTEN (v21.67). The caller's feedback used to be unconditional —
  // "✓ Filled" after a tap that wrote nothing is the difference between a member reporting
  // "nothing to fill this payslip" (true, diagnosable) and "the button doesn't work" (what got
  // reported, undiagnosable, and it outlived two fixes aimed at the tap itself).
  const written = [], cleared = [];
  for (const { hId, mId, cat } of HM_PAIRS) {
    const hVal = s[hId], mVal = s[mId];
    if (force) {
      const elH = /** @type {HTMLInputElement} */ (document.getElementById(hId));
      const elM = /** @type {HTMLInputElement} */ (document.getElementById(mId));
      if (!elH || !elM) continue;
      // A zero category is TWO different answers, and conflating them was the reported bug
      // (v21.68): "the engine knows nothing" (never write — a gold 0 would dress no-information
      // up as a confirmed none) versus "the calendar says NONE" (a shift removed in admin). A
      // member whose bank holiday was taken off the roster pressed Replace and her stale 7h
      // stayed — the one direction replace could not go was down to nothing, so she "had to do
      // it manually", and the phantom premium hours overstated the estimate until she did.
      // On an explicit Replace with FULLY-LOADED calendar data, zero IS the calendar's answer:
      // clear the field. clearZeros is the caller's assertion the data is complete — never set
      // in the base-only state, where the missing record might be exactly the hours on screen.
      if ((hVal == null || hVal === 0) && (mVal == null || mVal === 0)) {
        if (clearZeros && CLEARABLE_CATS.has(cat) && (elH.value.trim() !== '' || elM.value.trim() !== '')) {
          elH.value = ''; elM.value = '';
          elH.classList.remove('roster-suggested');
          elM.classList.remove('roster-suggested');
          cleared.push(cat);
        }
        continue;
      }
      elH.value = hVal ?? '';
      elM.value = mVal ?? '';
      elH.classList.add('roster-suggested');
      elM.classList.add('roster-suggested');
      written.push(cat);
    } else {
      _suggestIfBlank(hId, mId, hVal, mVal);
    }
  }
  _saveRosterSnap(currentPeriodNum(), s);
  return { written, cleared };
}

/**
 * Categories whose ABSENCE the calendar can actually assert — and therefore the only ones an
 * explicit Replace may CLEAR (v21.73, regression fix).
 *
 * Saturday, Sunday, bank holiday and Boxing Day are resolved from the ROSTER: if you are not
 * rostered that day, zero is a fact about your week, and a stale figure left over from a shift
 * since removed in admin is exactly the case v21.68 was written for.
 *
 * Overtime, RDW and bank-holiday overtime are the opposite. They exist ONLY where a shift change
 * was recorded, so zero means "nothing on record" and never "you worked none" — and the row is not
 * even rendered at zero, so there is nothing on screen warning the figure is at risk. v21.68 made
 * Replace clear those too: a member who typed 3h45m of overtime from their own notes lost it, at
 * time-and-a-quarter, to a button whose whole promise is that the calendar knows better. Failing to
 * clear costs a manual deletion the member can see; clearing wrongly destroys real money quietly,
 * and the two are not close enough to trade.
 */
const CLEARABLE_CATS = new Set(['sat', 'sun', 'bh', 'box']);

/** Staff-facing names for the fill categories, for the fill feedback line. */
const _CAT_LABELS = /** @type {Record<string,string>} */ ({
  sat: 'Saturday', sun: 'Sunday', bh: 'Bank holiday', bhOt: 'BH overtime',
  ot: 'Overtime', rdw: 'RDW', box: 'Boxing Day',
});

/**
 * Fills only the named category's hours from the current roster suggestion.
 * Force-fills because a row tap is an explicit user action.
 * @param {string} cat - Category key (e.g. 'sat', 'rdw').
 * @param {Function} autosave - Coordinator autosave callback.
 */
export function fillCategoryFromRoster(cat, autosave) {
  const p = getPeriods().find(/** @param {any} x */ x => x.num === currentPeriodNum());
  if (!p) return;
  const s = /** @type {any} */ (getRosterSuggestion(p, getLoggedMember()));
  if (!s) return;
  const pair = HM_PAIRS.find(p => p.cat === cat);
  if (!pair) return;
  const { hId, mId } = pair;
  const hVal = s[hId], mVal = s[mId];
  const elH = /** @type {HTMLInputElement} */ (document.getElementById(hId));
  const elM = /** @type {HTMLInputElement} */ (document.getElementById(mId));
  if (elH && elM && hVal != null) {
    elH.value = hVal ?? '';
    elM.value = mVal ?? '';
    elH.classList.add('roster-suggested');
    elM.classList.add('roster-suggested');
    // Merge this category into the existing snapshot so reload can restore the
    // roster-suggested class for just these fields (without clobbering other fields).
    const pNum = currentPeriodNum();
    try {
      const existing = JSON.parse(lsGet(snapKey(pNum)) || '{}');
      existing[hId] = hVal ?? '';
      existing[mId] = mVal ?? '';
      lsSet(snapKey(pNum), JSON.stringify(existing));
    } catch {}
  }
  autosave();
  // Programmatic value changes don't fire the input listeners — refresh the
  // roster card so the tapped row flips from "→ Fill" to "✓ matched".
  updateRosterHint();
}

/**
 * Fills ALL categories from the current roster suggestion, overwriting existing values.
 * @param {Function} autosave - Coordinator autosave callback.
 */
export async function fillFromRoster(autosave) {
  const p = getPeriods().find(/** @param {any} x */ x => x.num === currentPeriodNum());
  if (!p) return;
  const member = getLoggedMember();
  // Second chance for the shift-changes fetch (v21.67): on a phone with poor signal the
  // period-change fetch can fail silently, leaving base-only counts — and a member whose special
  // shifts exist as RECORDED CHANGES then gets a fill that misses exactly the hours they wanted.
  // The tap is an explicit "give me the calendar", so it is the right moment to try once more;
  // a failure falls through to base-only, which is what would have happened anyway.
  if (getOverridesFetchState() !== 'loaded' && member?.name) {
    try { await fetchOverridesForPeriod(p, member.name); } catch { /* base-only fallback */ }
  }
  const s = getRosterSuggestion(p, member);
  if (!s) return;
  // clearZeros only when the calendar data is COMPLETE: clearing on base-only counts could
  // wipe real hours whose recorded changes simply failed to load (the inverse of the bug).
  const { written, cleared } = _applyRosterSuggestion(s, true,
    { clearZeros: getOverridesFetchState() === 'loaded' });
  autosave();
  // Refresh row states (✓ matched) before the confirmation text swap below.
  updateRosterHint();
  const hint = document.getElementById('rosterHintText');
  if (hint) {
    const prev = hint.textContent;
    // The feedback states what HAPPENED, not what was attempted (v21.67): a tap that wrote
    // nothing used to say "✓ Filled", which turned a payslip with no special-rate shifts into
    // a bug report the tap fixes could never close.
    // NAME what was filled (v21.67): the fill deliberately covers special-rate hours only —
    // standard contracted hours are already in basic pay — and a member expecting the whole
    // timesheet reads an unnamed "✓ Filled" as the button not working. Naming the categories
    // makes the policy visible at the exact moment of the confusion.
    const _names = written.map(c => _CAT_LABELS[c] ?? c);
    const _what = _names.length > 3 ? `${written.length} categories` : _names.join(' + ');
    const _gone = cleared.map(c => _CAT_LABELS[c] ?? c).join(' + ');
    setStatus(hint, written.length > 0
      ? `✓ Filled ${_what}${cleared.length ? ` + cleared ${_gone}` : ''} — tap "Clear all entries" to undo`
      : cleared.length > 0
        ? `✓ Cleared ${_gone} — your calendar shows none`
        : (getOverridesFetchState() === 'loaded'
            ? 'Nothing to fill — no special-rate shifts on this payslip'
            : 'Nothing to fill — and recorded shift changes could not be loaded (check signal)'));
    setTimeout(() => { hint.textContent = prev; }, 4000);
  }
}
