/**
 * paycalc-roster-suggestions.js
 * Roster-to-pay suggestion engine for the pay calculator.
 *
 * Owns: override cache state, Firestore override fetch, per-period shift
 * categorisation (sat/sun/bh/bhOt/rdw/ot/box) and the day breakdown list.
 *
 * Does NOT own: DOM rendering, form filling, tax/NI/gross calculation.
 * Edit here for: overtime split rules, BH detection, override fetch logic.
 * Do not edit here for: pay maths (paycalc-calc.js), UI wiring (paycalc.js).
 */

import { teamMembers, getBaseShift, formatISO, getBankHolidays } from './roster-data.js?v=8.82';
import { db, collection, query, where, getDocs } from './firebase-client.js?v=8.82';

// ── OVERRIDE CACHE ────────────────────────────────────────────────────────────
// Per-date override cache for the current period — YYYY-MM-DD → { type, value }.
// Populated asynchronously by fetchOverridesForPeriod(); read synchronously by
// getRosterSuggestion(). Cleared on every period change so stale data from the
// previous period can never leak into the current one.
let _overridesByDate = new Map();

/** Test-only: inject a pre-built overrides map so unit tests bypass Firestore. */
export function _setOverridesForTest(map) { _overridesByDate = map; }

// Monotonic request token — incremented on every period change. A Firestore
// fetch only writes its results if its token is still the latest, so a slow
// fetch from an earlier period can never overwrite the current period's data.
let _overrideFetchToken = 0;

// 'checking':  Firestore fetch in progress — overrides not yet applied.
// 'base-only': No session, or fetch failed — showing base roster only.
// 'loaded':    Firestore succeeded — overrides applied to suggestions.
let _overridesFetchState = 'base-only';

/** Called from onPeriodChange to reset the cache before a new fetch starts. */
export function resetOverrides(newState) {
  _overrideFetchToken++;
  _overridesByDate = new Map();
  _overridesFetchState = newState;
}

/** Returns the current fetch state string for use in UI badge rendering. */
export function getOverridesFetchState() {
  return _overridesFetchState;
}

// ── BANK HOLIDAY HELPERS ──────────────────────────────────────────────────────
// Boxing Day (26 Dec) is handled separately at 3× rate, so it is excluded here.
function _bhsForYear(year) {
  return getBankHolidays(year).filter(d => !(d.getMonth() === 11 && d.getDate() === 26));
}

function _isDateBH(d) {
  return _bhsForYear(d.getFullYear()).some(bh =>
    bh.getMonth() === d.getMonth() && bh.getDate() === d.getDate()
  );
}

// ── OVERTIME FORMATTER ────────────────────────────────────────────────────────
const _fmtOt = m => { const h = Math.floor(m / 60), mm = m % 60; return `+${h}h${mm ? ' ' + mm + 'm' : ''}`; };

// ── FIRESTORE FETCH ───────────────────────────────────────────────────────────
/**
 * Queries Firestore for override documents in the period window and stores
 * them in _overridesByDate keyed by ISO date. Non-work values (AL, RD, SICK,
 * SPARE) are kept — getRosterSuggestion needs to know about them to skip the
 * base shift on that day.
 *
 * Returns a Promise resolving to:
 *   'loaded'    — overrides fetched and cached successfully
 *   'base-only' — fetch failed; cache remains empty
 *   'cancelled' — a newer period change superseded this fetch; caller must ignore
 *
 * The caller (paycalc.js) is responsible for updating the UI after the Promise
 * resolves. This function intentionally has no DOM access.
 *
 * @param {{ start: Date, cutoff: Date }} p
 * @param {string} memberName
 * @returns {Promise<'loaded'|'base-only'|'cancelled'>}
 */
export async function fetchOverridesForPeriod(p, memberName) {
  const thisToken = _overrideFetchToken;
  try {
    // Query by date range only — no memberName equality filter. Adding memberName
    // as an equality filter alongside a date range requires a composite Firestore
    // index that doesn't exist in this project.
    const q = query(
      collection(db, 'overrides'),
      where('date', '>=', formatISO(p.start)),
      where('date', '<=', formatISO(p.cutoff))
    );
    const snap = await getDocs(q);
    if (thisToken !== _overrideFetchToken) return 'cancelled';
    const map = new Map();
    snap.forEach(doc => {
      const d = doc.data();
      if (!d.date || d.memberName !== memberName) return;
      // Priority matches app.js calendar: manual always beats roster_import;
      // within the same class, newer createdAt wins.
      const existing     = map.get(d.date);
      const docTs        = d.createdAt?.toMillis?.() ?? 0;
      const isManual     = d.source !== 'roster_import';
      const existManual  = existing?._manual ?? false;
      const wins = !existing
        || (isManual && !existManual)
        || (isManual === existManual && docTs > (existing._ts ?? -1));
      if (wins) map.set(d.date, { type: d.type, value: d.value, _ts: docTs, _manual: isManual });
    });
    _overridesByDate = map;
    _overridesFetchState = 'loaded';
    return 'loaded';
  } catch {
    _overridesFetchState = 'base-only';
    return 'base-only';
  }
}

// ── SUGGESTION ENGINE ─────────────────────────────────────────────────────────
/**
 * Scan the period window using the logged-in member's base roster, merged with
 * any admin-entered overrides from Firestore. Categorises each worked shift into:
 * sat, sun, bh (rostered BH), bhOt (BH overtime), rdw, ot (general overtime), box.
 *
 * Split rule for extended shifts: if an admin override is longer than the base
 * roster (overtime recorded by extending the shift time), the base hours go to
 * the rostered category and the excess goes to the overtime category.
 *
 * Returns null if there are no special-category shifts in the period.
 *
 * @param {{ start: Date, cutoff: Date }} p - Pay period object
 * @param {object} member - teamMembers entry for the logged-in user (caller's responsibility)
 * @returns {object|null}
 */
export function getRosterSuggestion(p, member) {
  if (!member) return null;

  let satMins = 0, sunMins = 0, bhMins = 0, bhOtMins = 0, otMins = 0, boxMins = 0, rdwMins = 0;
  let satCount = 0, sunCount = 0, bhCount = 0, bhOtCount = 0, otCount = 0, boxCount = 0, rdwCount = 0;
  let satFromOv = false, sunFromOv = false, bhFromOv = false, boxFromOv = false;
  const days = [];

  const cur = new Date(p.start);
  while (cur <= p.cutoff) {
    const noon = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate(), 12);
    const iso  = formatISO(cur);
    const ov   = _overridesByDate.get(iso);

    // Always read baseValue independently so the split logic can compare
    // the override duration against the rostered duration.
    const baseValue = getBaseShift(member, noon);
    const effValue  = ov ? ov.value : baseValue;
    const effType   = ov ? ov.type  : null;

    if (effValue && effValue.includes('-') && effValue.includes(':')) {
      const parts = effValue.split('-');
      const [sh, sm] = parts[0].split(':').map(Number);
      const [eh, em] = parts[1].split(':').map(Number);
      let mins = (eh * 60 + em) - (sh * 60 + sm);
      if (mins <= 0) mins += 24 * 60; // overnight shift

      const dow      = cur.getDay(); // 0 = Sun, 6 = Sat
      const isBoxing = cur.getMonth() === 11 && cur.getDate() === 26;
      const isBH     = !isBoxing && _isDateBH(cur);
      const fromOv   = !!ov;

      // Pre-compute base duration to cap rostered hours and detect overtime
      // when admin extends a shift beyond the base roster.
      const baseWorked = baseValue && baseValue.includes('-') && baseValue.includes(':');
      let baseMins = 0;
      if (baseWorked) {
        const [bst, ben] = baseValue.split('-');
        const [bsh, bsm] = bst.split(':').map(Number);
        const [beh, bem] = ben.split(':').map(Number);
        baseMins = (beh * 60 + bem) - (bsh * 60 + bsm);
        if (baseMins <= 0) baseMins += 24 * 60;
      }

      if (isBoxing) {
        boxMins += mins; boxCount++;
        if (fromOv) boxFromOv = true;
        days.push({ date: new Date(cur), shift: effValue, type: 'box', source: fromOv ? 'override' : 'base' });

      } else if (isBH) {
        if (effType === 'rdw') {
          // RDW override on a BH day: if there was also a rostered base shift,
          // show both (rostered hours → bhRow, overtime → bhOtRow).
          if (baseWorked) {
            bhMins   += baseMins; bhCount++;
            bhOtMins += mins;     bhOtCount++;
            days.push({ date: new Date(cur), shift: baseValue, type: 'bh',   source: 'base'     });
            days.push({ date: new Date(cur), shift: effValue,  type: 'bhOt', source: 'override' });
          } else {
            bhOtMins += mins; bhOtCount++;
            days.push({ date: new Date(cur), shift: effValue, type: 'bhOt', source: 'override' });
          }
        } else if (fromOv && baseWorked) {
          // Shift override on a rostered BH: cap at base, excess to bhOt.
          const rostered = Math.min(mins, baseMins);
          const ot       = mins - rostered;
          bhMins += rostered; bhCount++;
          bhFromOv = true;
          days.push({ date: new Date(cur), shift: effValue, type: 'bh', source: 'override' });
          if (ot > 0) {
            bhOtMins += ot; bhOtCount++;
            days.push({ date: new Date(cur), shift: _fmtOt(ot), type: 'bhOt', source: 'override' });
          }
        } else {
          bhMins += mins; bhCount++;
          if (fromOv) bhFromOv = true;
          days.push({ date: new Date(cur), shift: effValue, type: 'bh', source: fromOv ? 'override' : 'base' });
        }

      } else if (dow === 0) {
        sunMins += mins; sunCount++;
        if (fromOv) sunFromOv = true;
        days.push({ date: new Date(cur), shift: effValue, type: 'sun', source: fromOv ? 'override' : 'base' });

      } else if (effType === 'rdw') {
        rdwMins += mins; rdwCount++;
        days.push({ date: new Date(cur), shift: effValue, type: 'rdw', source: 'override' });

      } else if (dow === 6) {
        // Saturday: cap at base, excess to general overtime.
        if (fromOv && baseWorked) {
          const rostered = Math.min(mins, baseMins);
          const ot       = mins - rostered;
          satMins += rostered; satCount++;
          satFromOv = true;
          days.push({ date: new Date(cur), shift: effValue, type: 'sat', source: 'override' });
          if (ot > 0) {
            otMins += ot; otCount++;
            days.push({ date: new Date(cur), shift: _fmtOt(ot), type: 'ot', source: 'override' });
          }
        } else {
          satMins += mins; satCount++;
          if (fromOv) satFromOv = true;
          days.push({ date: new Date(cur), shift: effValue, type: 'sat', source: fromOv ? 'override' : 'base' });
        }

      } else {
        // Mon–Fri non-BH non-RDW: base hours are contracted basic pay.
        // Only the excess beyond the base roster counts as overtime.
        if (fromOv && baseWorked) {
          const ot = Math.max(0, mins - baseMins);
          if (ot > 0) {
            otMins += ot; otCount++;
            days.push({ date: new Date(cur), shift: _fmtOt(ot), type: 'ot', source: 'override' });
          }
        }
      }
    }
    cur.setDate(cur.getDate() + 1);
  }

  if (!satCount && !sunCount && !bhCount && !bhOtCount && !otCount && !rdwCount && !boxCount) return null;

  return {
    satH:  Math.floor(satMins  / 60), satM:  satMins  % 60,
    sunH:  Math.floor(sunMins  / 60), sunM:  sunMins  % 60,
    bhH:   Math.floor(bhMins   / 60), bhM:   bhMins   % 60,
    bhOtH: Math.floor(bhOtMins / 60), bhOtM: bhOtMins % 60,
    otH:   Math.floor(otMins   / 60), otM:   otMins   % 60,
    rdwH:  Math.floor(rdwMins  / 60), rdwM:  rdwMins  % 60,
    boxH:  Math.floor(boxMins  / 60), boxM:  boxMins  % 60,
    satCount, sunCount, bhCount, bhOtCount, otCount, rdwCount, boxCount,
    satFromOv, sunFromOv, bhFromOv, bhOtFromOv: true, boxFromOv, rdwFromOv: true,
    memberName: member.name,
    days: days.sort((a, b) => a.date - b.date),
  };
}
