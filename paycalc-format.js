/**
 * paycalc-format.js — shared date/currency formatters for paycalc modules.
 * Pure: no DOM, no Firebase, no side effects. Imported by paycalc-app.js and paycalc-backpay.js.
 */

/** @param {Date} d */
export const fd = d => d.toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: '2-digit', timeZone: 'Europe/London',
});

/** @param {Date} d */
export const fdShort = d => d.toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', timeZone: 'Europe/London',
});

/** @param {number} n */
export const fmt = n => '£' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

// ── Time-input helpers (pure cores of the paycalc hrs/mins fields) ──────────────
// Extracted from paycalc-app.js (Section G / G1) so the arithmetic is unit-testable and
// written once. The coordinator keeps the thin DOM wrappers (clampMins/decPreview/
// autoDecimalHours) that read/write the inputs and call these.

/**
 * Clamp a minutes value to the valid 0–59 range.
 * @param {number} n a parsed minutes integer (caller has already handled NaN)
 * @returns {number} n clamped into [0, 59]
 */
export const clampMinute = n => Math.min(59, Math.max(0, n));

/**
 * Split a decimal-hours value into whole hours + minutes, rounding minutes to the nearest
 * whole and carrying 60 → next hour (floating-point guard, e.g. 7.999 → 8h 00m). This is the
 * single source for the "= 7h 30m" live preview and the on-blur "7.5 → 7 hrs 30 mins" split.
 * @param {number} val decimal hours (e.g. 7.5)
 * @returns {{h:number, m:number}|null} null for a negative or non-finite input
 */
export function decimalToHM(val) {
    if (!isFinite(val) || val < 0) return null;
    let h = Math.floor(val);
    let m = Math.round((val - h) * 60);
    if (m >= 60) { h += 1; m = 0; }
    return { h, m };
}
