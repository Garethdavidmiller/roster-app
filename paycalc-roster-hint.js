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
import { getRosterSuggestion, getOverridesFetchState } from './paycalc-roster-suggestions.js';
import { escapeHtml } from './roster-data.js';
import { lsGet, lsSet } from './ls.js';

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
function _confBadge(cat, fromOv) {
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
  if (hVal == null && mVal == null) return;
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
export const snapKey = pNum => `myb_pc_snap_${pNum}`;

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
  const pairs = [
    ['satH',  'satM',  snap.satH,  snap.satM ],
    ['sunH',  'sunM',  snap.sunH,  snap.sunM ],
    ['bhH',   'bhM',   snap.bhH,   snap.bhM  ],
    ['bhOtH', 'bhOtM', snap.bhOtH, snap.bhOtM],
    ['otH',   'otM',   snap.otH,   snap.otM  ],
    ['rdwH',  'rdwM',  snap.rdwH,  snap.rdwM ],
    ['boxH',  'boxM',  snap.boxH,  snap.boxM ],
  ];
  for (const [hId, mId, hVal, mVal] of pairs) {
    const elH = /** @type {HTMLInputElement} */ (document.getElementById(hId));
    const elM = /** @type {HTMLInputElement} */ (document.getElementById(mId));
    if (!elH || !elM) continue;
    if (elH.value === String(hVal || '')) elH.classList.add('roster-suggested');
    if (elM.value === String(mVal || '')) elM.classList.add('roster-suggested');
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
      badge.textContent  = '✓ Includes recorded changes';
      badge.className    = 'roster-state-badge loaded';
    } else if (getOverridesFetchState() === 'base-only') {
      badge.textContent  = '⚠ Scheduled only';
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

      const conf     = _confBadge(r.cat, r.fromOv);
      const confHtml = conf ? `<span class="conf-badge ${conf.cls}">${conf.text}</span>` : '';

      let rowClass, totalText, metaText, arrowHtml, ariaLabel;
      if (enteredMins === null) {
        rowClass  = 'roster-row';
        totalText = fmtH(r.h, r.m);
        metaText  = confHtml ? `${dayStr} · ${confHtml}` : dayStr;
        arrowHtml = `<span class="roster-cat-arrow" aria-hidden="true">→</span>`;
        ariaLabel = `Fill ${r.label} hours from roster`;
      } else if (enteredMins === suggestMins) {
        rowClass  = 'roster-row roster-row--matched';
        totalText = fmtH(r.h, r.m);
        metaText  = dayStr;
        arrowHtml = `<span class="roster-cat-match" aria-hidden="true">✓</span>`;
        ariaLabel = `${r.label} matches roster: ${fmtH(r.h, r.m)}`;
      } else {
        const entH = Math.floor(enteredMins / 60), entM = enteredMins % 60;
        rowClass  = 'roster-row roster-row--differs';
        totalText = `${fmtH(entH, entM)} entered`;
        metaText  = confHtml ? `Roster: ${fmtH(r.h, r.m)} · ${confHtml}` : `Roster: ${fmtH(r.h, r.m)}`;
        arrowHtml = `<span class="roster-cat-arrow roster-cat-arrow--differs" aria-hidden="true">→</span>`;
        ariaLabel = `${r.label}: you have ${fmtH(entH, entM)}, roster says ${fmtH(r.h, r.m)}. Tap to use roster`;
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
      : 'Base roster only — recorded shift changes not yet loaded. Special-rate hours only; standard contracted hours are already included in basic pay.';
  }

  const fillBtn = document.getElementById('fillFromRosterBtn');
  if (fillBtn) {
    const hasEntries = ['sat', 'sun', 'bh', 'bhOt', 'ot', 'rdw', 'box'].some(cat => {
      const h = /** @type {HTMLInputElement} */ (document.getElementById(cat + 'H'))?.value.trim() ?? '';
      const m = /** @type {HTMLInputElement} */ (document.getElementById(cat + 'M'))?.value.trim() ?? '';
      return h !== '' || m !== '';
    });
    fillBtn.textContent = hasEntries ? 'Replace with calendar values' : 'Fill from calendar';
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
  const startFmt     = member.startDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
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
export function _applyRosterSuggestion(s, force = false) {
  const pairs = [
    ['satH',  'satM',  s.satH,  s.satM ],
    ['sunH',  'sunM',  s.sunH,  s.sunM ],
    ['bhH',   'bhM',   s.bhH,   s.bhM  ],
    ['bhOtH', 'bhOtM', s.bhOtH, s.bhOtM],
    ['otH',   'otM',   s.otH,   s.otM  ],
    ['rdwH',  'rdwM',  s.rdwH,  s.rdwM ],
    ['boxH',  'boxM',  s.boxH,  s.boxM ],
  ];
  for (const [hId, mId, hVal, mVal] of pairs) {
    if (force) {
      const elH = /** @type {HTMLInputElement} */ (document.getElementById(hId));
      const elM = /** @type {HTMLInputElement} */ (document.getElementById(mId));
      if (!elH || !elM) continue;
      if (hVal == null && mVal == null) continue;
      elH.value = hVal ?? '';
      elM.value = mVal ?? '';
      elH.classList.add('roster-suggested');
      elM.classList.add('roster-suggested');
    } else {
      _suggestIfBlank(hId, mId, hVal, mVal);
    }
  }
  _saveRosterSnap(currentPeriodNum(), s);
}

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
  const map = /** @type {Record<string, any>} */ ({
    sat:  ['satH',  'satM',  s.satH,  s.satM ],
    sun:  ['sunH',  'sunM',  s.sunH,  s.sunM ],
    bh:   ['bhH',   'bhM',   s.bhH,   s.bhM  ],
    bhOt: ['bhOtH', 'bhOtM', s.bhOtH, s.bhOtM],
    ot:   ['otH',   'otM',   s.otH,   s.otM  ],
    rdw:  ['rdwH',  'rdwM',  s.rdwH,  s.rdwM ],
    box:  ['boxH',  'boxM',  s.boxH,  s.boxM ],
  });
  const args = map[cat];
  if (!args) return;
  const [hId, mId, hVal, mVal] = args;
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
export function fillFromRoster(autosave) {
  const p = getPeriods().find(/** @param {any} x */ x => x.num === currentPeriodNum());
  if (!p) return;
  const s = getRosterSuggestion(p, getLoggedMember());
  if (!s) return;
  _applyRosterSuggestion(s, true);
  autosave();
  // Refresh row states (✓ matched) before the confirmation text swap below.
  updateRosterHint();
  const hint = document.getElementById('rosterHintText');
  if (hint) {
    const prev = hint.textContent;
    hint.textContent = '✓ Filled — tap "Clear all entries" to undo';
    setTimeout(() => { hint.textContent = prev; }, 3000);
  }
}
