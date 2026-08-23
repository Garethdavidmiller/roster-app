// @ts-check
// Pay-calculator form-field input helpers — extracted from paycalc-app.js (v18.60, review item 10:
// "continue focused coordinator extraction"). These read/normalise the numbers a member types into
// the hours & figures fields and own the live "= 7h 30m" decimal-conversion hint.
//
// They depend ONLY on the DOM (`document`) plus the pure number/format helpers imported below — NO
// coordinator closure state — so they lift cleanly out of paycalc-app.js's init() and are
// unit-testable in Node against a fake `document` (paycalc-inputs.test.mjs). The event WIRING that
// USES them (autoDecimalHours, onHhMm) stays in the coordinator, because it closes over
// calculate()/autosave()/period state; it simply calls these primitives.

import { parseSmartFloat, parseSmartFloatOrNull } from './roster-data.js';
import { clampMinute, decimalToHM } from './paycalc-format.js';

/** @param {string} id */
export function numVal(id) {
    // iOS keyboards can insert smart hyphens/minus and curly quotes; parseSmartFloat
    // strips them so parseFloat doesn't silently return NaN on otherwise-valid input.
    return parseSmartFloat(/** @type {HTMLInputElement} */ (document.getElementById(id))?.value ?? '');
}

/**
 * numVal, but floors an unparseable (NaN) result to `fallback`. The signed fields
 * (pension, Year-to-Date pay/tax) read numVal RAW after only a non-empty guard, so a
 * stray/pasted character (parseSmartFloat → NaN) would cascade £NaN through the whole
 * result card. Hours self-floor via intVal's `|| 0`; these need an explicit floor.
 * @param {string} id @param {number|null} fallback
 * @returns {number|null}
 */
export function numValOr(id, fallback) {
    // parseSmartFloatOrNull, NOT numVal: parseSmartFloat floors garbage to 0 (its `|| 0`), so
    // the old Number.isFinite(numVal(id)) check was dead code — an unparseable Year-to-Date
    // remnant (a lone "." or "-" left mid-edit, then autosaved) became £0, which flipped
    // computeTax into cumulative mode and collapsed Income Tax to £0.00. A non-parseable OR
    // empty value now genuinely returns the fallback ("not provided").
    const v = parseSmartFloatOrNull(/** @type {HTMLInputElement} */ (document.getElementById(id))?.value ?? '');
    return v === null ? fallback : v;
}

/** @param {string} id */
// Math.max(0, …) floors at zero: hours/minutes can never be negative, and on desktop the
// numeric field will accept a typed/pasted "-5" (mobile's numeric keypad has no minus), which
// would otherwise subtract pay. Used only for hour/minute reads (hhmmDec) — never a signed field.
export function intVal(id)    { return Math.max(0, parseInt(/** @type {HTMLInputElement} */ (document.getElementById(id))?.value ?? '') || 0); }

/**
 * @param {string} hId
 * @param {string} mId
 */
export function hhmmDec(hId, mId) { return intVal(hId) + intVal(mId) / 60; }

/** @param {string} mId */
export function clampMins(mId) {
  const el = /** @type {HTMLInputElement|null} */ (document.getElementById(mId));
  if (!el) return;
  const v  = parseInt(el.value);
  if (isNaN(v)) return;
  const c = clampMinute(v);
  if (c !== v) el.value = String(c); // only rewrite when out of range (preserves a typed "05")
}

// Find (or lazily create) the live decimal-conversion hint that sits beneath an
// hours field's hrs:mins pair. Returns null if the field/markup is missing.
/**
 * @param {string} hId
 * @param {boolean} make
 */
export function _decHintEl(hId, make) {
  const wrap = document.getElementById(hId)?.closest('.hhmm-wrap');
  if (!wrap) return null;
  const col = wrap.parentElement;
  if (!col) return null;
  let hint = col.querySelector('.hhmm-dec-hint');
  if (!hint && make) {
    hint = document.createElement('div');
    hint.className = 'hhmm-dec-hint';
    hint.setAttribute('aria-hidden', 'true');
    col.appendChild(hint);
  }
  return hint;
}

// Live "= 7h 30m" preview shown WHILE a decimal is being typed, so the on-blur
// split is a visible transformation rather than a silent one (trust on a pay form).
/** @param {string} hId */
export function decPreview(hId) {
  const raw = /** @type {HTMLInputElement} */ (document.getElementById(hId)).value;
  const val = parseSmartFloat(raw);
  const hm = raw.includes('.') ? decimalToHM(val) : null;
  if (hm) {
    const hint = /** @type {HTMLElement | null} */ (_decHintEl(hId, true));
    if (hint) { hint.textContent = `= ${hm.h}h ${String(hm.m).padStart(2, '0')}m`; hint.hidden = false; }
  } else {
    const hint = /** @type {HTMLElement | null} */ (_decHintEl(hId, false));
    if (hint) hint.hidden = true;
  }
}

/**
 * Wire an element so its action fires on iOS even when tapping it dismisses the soft keyboard.
 *
 * THE FAILURE THIS EXISTS FOR (measured on the ± sign button, re-reported v21.66 on the roster
 * fill controls): tapping a button while a number input is focused makes iOS dismiss the keyboard
 * first, and the viewport shift that follows cancels the touch-to-click synthesis — `click` never
 * fires. To the member the button "doesn't always work": it works whenever the keyboard happens to
 * be down, and swallows the tap whenever it is up, which on a form you type hours into is most of
 * the time. `touchend` fires BEFORE the dismissal, so the action runs from there on touch devices,
 * with `click` kept for mouse/keyboard/assistive tech.
 *
 * Two guards, both load-bearing:
 *  - `preventDefault()` on the touchend (registered passive:false — iOS defaults touchend to
 *    passive) suppresses the synthesised click on the taps where it WOULD have fired, so the
 *    action can never run twice; `touchFired` covers browsers that synthesise one anyway.
 *  - A movement gate: the ± button shipped without one and its targets are tiny, but the fill
 *    controls are full-width rows a scroll flick can begin and END on — and "Replace with calendar
 *    values" is destructive. A touch that moved more than the slop, or was ever multi-finger, is a
 *    scroll, not a tap, and must fall through to the browser (which will not send a click either).
 *
 * @param {HTMLElement} el
 * @param {(e: Event) => void} action  Receives the triggering event (touchend or click), so
 *   delegated callers can read `e.target`.
 */
export function wireIosTap(el, action) {
  const SLOP = 12;
  let sx = 0, sy = 0, moved = false, touchFired = false;
  el.addEventListener('touchstart', (e) => {
    const te = /** @type {TouchEvent} */ (e);
    if (te.touches.length !== 1) { moved = true; return; }
    moved = false; sx = te.touches[0].clientX; sy = te.touches[0].clientY;
  }, { passive: true });
  el.addEventListener('touchmove', (e) => {
    const t = /** @type {TouchEvent} */ (e).touches[0];
    if (!t || Math.abs(t.clientX - sx) > SLOP || Math.abs(t.clientY - sy) > SLOP) moved = true;
  }, { passive: true });
  el.addEventListener('touchend', (e) => {
    if (moved) return;
    e.preventDefault();
    touchFired = true;
    action(e);
  }, { passive: false });
  el.addEventListener('click', (e) => {
    if (touchFired) { touchFired = false; return; }
    action(e);
  });
}
