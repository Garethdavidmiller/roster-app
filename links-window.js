// @ts-check
/**
 * links-window.js — the OPERATING WINDOW of a link design: when the station is staffed.
 *
 * `LINKS_DEC2026_PLAN.md` package 1. Pure — no DOM, no Firebase.
 *
 * WHY THIS EXISTS, and it is a stronger reason than the plan recorded.
 *
 * The coverage heat map derived its own span from the design: it showed the hours between the first
 * and last duty anybody worked, and called an hour a GAP only when it fell strictly between them.
 * So the one thing it could not see was cover missing at the START or END of the day — the span
 * simply shrank to fit, and the missing hours left the table entirely. A 28-line design where
 * everybody finishes at 14:20, leaving Marylebone unstaffed from then until the 23:55 close,
 * rendered as a wall of solid colour with **no gaps flagged at all**. Measured, not supposed.
 *
 * A design cannot be read against a window it does not carry. Storing the window turns the heat map
 * from "the shape of this design" into "this design against the hours it has to cover", which is
 * the question being asked of it.
 *
 * PER-DESIGN, not global: a proposal may legitimately test a MOVED boundary — the live example is
 * Sunday, where five December 2026 movements fall after the current 23:25 finish. Compare mode can
 * then put the current window beside a moved one, which is the argument you would actually put to
 * the assessing manager.
 *
 * **The trap that comes with per-design.** Compare mode highlights differing CELLS, not differing
 * WINDOWS. Two designs built to different spans would compare as though they were like for like, so
 * the override becomes a way to make an unfair comparison look fair. Anywhere two designs are shown
 * together — compare columns, the printed sheet — MUST state the window. `formatWindow` and
 * `windowsDiffer` exist for exactly that; do not render a comparison without them.
 */

/**
 * The CEA operating window today (owner, Aug 2026). Mon–Sat and Sunday are separate rows because
 * the operation genuinely differs; Saturday can split from Mon–Fri later if it ever diverges (the
 * generator already has three columns, so the plumbing exists).
 */
export const DEFAULT_WINDOW = Object.freeze({
    monSat: Object.freeze({ start: '06:20', end: '23:55' }),
    sun:    Object.freeze({ start: '07:15', end: '23:25' }),
});

/** The two rows a window carries. */
export const WINDOW_ROWS = /** @type {const} */ (['monSat', 'sun']);

/**
 * Minutes since midnight for "HH:MM", or null if it is not a real time of day.
 * @param {any} value
 */
export function windowMinutes(value) {
    const m = typeof value === 'string' && value.trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    const h = +m[1], mins = +m[2];
    if (h > 23 || mins > 59) return null;
    return h * 60 + mins;
}

/**
 * Pad a typed time to the canonical "HH:MM".
 *
 * The editor uses TEXT inputs, not `<input type="time">`: Chromium renders that widget in the OS's
 * 12-hour format even at en-GB, so a designer would have been setting "11:55 PM" beside a grid,
 * a heat map and a `formatWindow` line all reading 23:55. Measured in both locales. A text field
 * keeps one clock across the whole workspace; the cost is that padding is ours to do.
 * @param {any} value
 * @returns {string|null} "HH:MM", or null if it is not a time
 */
export function canonicaliseWindowTime(value) {
    const mins = windowMinutes(value);
    if (mins === null) return null;
    return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}

/**
 * Is this row a usable window — two real times, in order?
 *
 * A row that ENDS before it starts is rejected rather than wrapped. The rest of the workspace bans
 * a wrapping duty at the input boundary (`normaliseCustomShift`), and a window that wrapped past
 * midnight would make "inside the window" true for hours on two different days — which is not a
 * thing the heat map, a row per day, can express.
 * @param {any} row
 */
export function isValidWindowRow(row) {
    if (!row || typeof row !== 'object') return false;
    const a = windowMinutes(row.start), b = windowMinutes(row.end);
    return a !== null && b !== null && b > a;
}

/**
 * Read a stored window into the canonical shape, falling back to the default.
 *
 * Validated PER ROW. A design with a good Sunday and a corrupt Mon–Sat keeps the Sunday it was
 * saved with — the two rows are independent settings, so discarding a valid one because its
 * neighbour is broken would throw away a real decision. What is NOT done is per-FIELD fallback:
 * pairing a stored start with a default end would invent a window nobody chose, and it would look
 * deliberate on the printed sheet.
 * @param {any} raw
 * @returns {{monSat: {start: string, end: string}, sun: {start: string, end: string}}}
 */
export function normaliseWindow(raw) {
    const out = /** @type {any} */ ({});
    for (const row of WINDOW_ROWS) {
        const stored = raw && typeof raw === 'object' ? raw[row] : null;
        out[row] = isValidWindowRow(stored)
            ? { start: String(stored.start), end: String(stored.end) }
            : { ...DEFAULT_WINDOW[row] };
    }
    return out;
}

/**
 * The window row that governs a given day key.
 * @param {any} win
 * @param {string} day - a DAYS key ('sun'…'sat')
 */
export function windowForDay(win, day) {
    const w = normaliseWindow(win);
    return day === 'sun' ? w.sun : w.monSat;
}

/**
 * Does the staffed window cover any part of clock hour `hour` on `day`?
 *
 * ANY part, deliberately: the day opens at 06:20, so the 06:00 hour is a staffed hour with cover
 * required in it. Treating it as outside the window would hide a genuine hole in the first duty.
 * @param {any} win
 * @param {string} day
 * @param {number} hour - 0–23
 */
export function isHourStaffed(win, day, hour) {
    const row = windowForDay(win, day);
    const start = /** @type {number} */ (windowMinutes(row.start));
    const end   = /** @type {number} */ (windowMinutes(row.end));
    return start < (hour + 1) * 60 && end > hour * 60;
}

/**
 * The hour columns a heat map must show: every hour staffed on ANY day, plus any hour someone is
 * actually on duty.
 *
 * The second half is the point. Bounding the table by the window alone would hide a duty that runs
 * OUTSIDE it — which is precisely the thing a reviewer needs to see, since it means the design has
 * put someone on when the station is not open. The span therefore covers the union, and it is
 * `isHourStaffed` that tells the renderer which of those columns is inside the window.
 * @param {any} win
 * @param {Record<string, {hours: number[]}>} hourly - calcHourlyCoverage output
 * @param {string[]} days
 * @returns {{minH: number, maxH: number}} maxH is EXCLUSIVE
 */
export function heatSpan(win, hourly, days) {
    let minH = 24, maxH = 0;
    for (const d of days) {
        for (let h = 0; h < 24; h++) {
            const worked = (hourly?.[d]?.hours?.[h] ?? 0) > 0;
            if (worked || isHourStaffed(win, d, h)) {
                if (h < minH) minH = h;
                if (h + 1 > maxH) maxH = h + 1;
            }
        }
    }
    return minH >= maxH ? { minH: 6, maxH: 24 } : { minH, maxH };
}

/**
 * Human-readable, for the Coverage card, the compare column headers and the printed sheet.
 * @param {any} win
 */
export function formatWindow(win) {
    const w = normaliseWindow(win);
    return `Mon–Sat ${w.monSat.start}–${w.monSat.end} · Sun ${w.sun.start}–${w.sun.end}`;
}

/**
 * Do two designs claim different staffed hours?
 *
 * The guard against the trap in the module header: compare mode diffs cells, so without this two
 * designs built to different spans would read as like-for-like.
 * @param {any} a
 * @param {any} b
 */
export function windowsDiffer(a, b) {
    const x = normaliseWindow(a), y = normaliseWindow(b);
    return WINDOW_ROWS.some(r => x[r].start !== y[r].start || x[r].end !== y[r].end);
}

/**
 * Is this window the app default? Used so a design that never moved its boundaries does not shout
 * about it — the default is the norm and needs no announcement, a moved one always does.
 * @param {any} win
 */
export function isDefaultWindow(win) {
    return !windowsDiffer(win, DEFAULT_WINDOW);
}
