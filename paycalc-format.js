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
