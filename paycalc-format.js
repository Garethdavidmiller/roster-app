// @ts-check
/**
 * paycalc-format.js — shared date/currency formatters for paycalc modules.
 * Pure: no DOM, no Firebase, no side effects. Imported by paycalc-app.js and paycalc-backpay.js.
 */

// NO timeZone option (review fix): period Dates are LOCAL-calendar values (constructed at
// device-local noon by getPeriods), not instants — so they must render in the device's own
// timezone. Forcing 'Europe/London' shifted the printed day one back on devices at UTC+13/+14
// (device-local noon 13 Feb = 22:59Z the 12th = London 12 Feb).
/** @param {Date} d */
export const fd = d => d.toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: '2-digit',
});

/** @param {Date} d */
export const fdShort = d => d.toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short',
});

// Full-year variant ("3 Jul 2026") — the payday/joined-on/printed-on long form. Was duplicated
// inline as `.toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' })` in
// paycalc-app / paycalc-backpay / paycalc-periods / paycalc-roster-hint before being written once
// here (review item 21). Same no-timeZone rationale as fd above.
/** @param {Date} d */
export const fdLong = d => d.toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
});

/** @param {number} n */
export const fmt = n => '£' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/**
 * A capped, comma-joined list of payday dates for "these payslips are missing" copy
 * (v18.42 — review item 2): "5 Jun, 3 Jul, 31 Jul, 28 Aug and 3 more". Capping keeps the line
 * readable on mobile when many payslips are empty; the overflow count still says HOW MANY, so
 * nothing is silently hidden (no-silent-caps). Pure.
 * @param {Date[]} dates @param {number} [cap]
 * @returns {string}
 */
export function fdList(dates, cap = 4) {
    const names = dates.map(fdShort);
    if (names.length <= cap) return names.join(', ');
    return `${names.slice(0, cap).join(', ')} and ${names.length - cap} more`;
}

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

/**
 * The seven premium hour/minute field pairs — the ONE table tying a fill category to its two DOM
 * ids, which double as the saved-period data keys. Lived in paycalc-roster-hint.js until v22.06;
 * moved here (the pure shared home) so paycalc-fill-year.js can load in Node — the hint module's
 * import chain reaches the gstatic SDK.
 */
export const HM_PAIRS = [
    { cat: 'sat',  hId: 'satH',  mId: 'satM'  },
    { cat: 'sun',  hId: 'sunH',  mId: 'sunM'  },
    { cat: 'bh',   hId: 'bhH',   mId: 'bhM'   },
    { cat: 'bhOt', hId: 'bhOtH', mId: 'bhOtM' },
    { cat: 'ot',   hId: 'otH',   mId: 'otM'   },
    { cat: 'rdw',  hId: 'rdwH',  mId: 'rdwM'  },
    { cat: 'box',  hId: 'boxH',  mId: 'boxM'  },
];

/**
 * Is a saved period the empty shape — nothing the member (or a fill) has put there? The gate the
 * "Not entered yet" list and the fill-year eligibility share. Lived in paycalc-hpp.js until
 * v22.06; it sits here beside HM_PAIRS because the two together are the schema's field surface,
 * and this is the paycalc cluster's zero-import home (Node-loadable from anywhere).
 * @param {any} d @returns {boolean}
 */
export function isDataEmpty(d) {
    return !d.satH && !d.satM &&
        !d.bhH && !d.bhM &&
        !d.bhOtH && !d.bhOtM &&
        !d.otH && !d.otM &&
        !d.rdwH && !d.rdwM &&
        !d.sunH && !d.sunM &&
        !d.boxH && !d.boxM && !d.peer &&
        !d.slSkip && !d.otherAdj;
}
