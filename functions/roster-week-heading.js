'use strict';

/**
 * functions/roster-week-heading.js — the week the roster SAYS it is for, and the refusal when that is
 * not the week chosen on the upload form (import-server-2; the owner supplied a real sheet, 10 Nov 2026).
 *
 * CommonJS, like every file under functions/. Requires `london-clock.js` only. `roster-geometry.js`
 * collects the headings from the text runs it already reads, and `functions/index.js` checks them
 * before the model is asked anything — or, when its early wait on that read gave up, once the read
 * settles, as the geometry witness is re-asked. Tested by roster-geometry.test.mjs and, through the
 * handler, index-endpoints.test.mjs. The import's contract is `.claude/rules/roster-import.md`.
 *
 * ── A WHOLE WEEK OUT, WHICH NOTHING ELSE CAN SEE ────────────────────────────────────────────────
 *
 * Every date an import writes comes from the week chosen on the form. A sheet read against the wrong
 * week lands every row seven days out, and the day-drift defences cannot see it: they compare one day
 * either way. The sheet says which week it is. Measured on a real CEA roster: page 1 prints the label
 * `Week Ending:` and a `DD/MM/YYYY` date above the drawn grid, as two text runs on one line, and the
 * continuation pages do not repeat it. That is the PDF's own text, not the model's reading of it, so
 * this check — layer 4 of the day-drift defence — does not depend on the model at all.
 *
 * ── NEVER GUESS, IN EITHER DIRECTION ────────────────────────────────────────────────────────────
 *
 * A heading that names a real Saturday other than the week chosen REFUSES the whole read, with a
 * message naming both weeks. Anything less certain refuses nothing and is logged: no text layer (a
 * scanned sheet), a layout without the heading (the Supervisor and Dispatch sheets are not measured),
 * a date that is not a calendar date or not a Saturday. Only `DD/MM/YYYY` after the label is read,
 * because the footer's `Print Date:` carries a date too, and it is never the week.
 */

const { isValidIsoDate, isoDayOfWeek } = require('./london-clock');

/** The label, then the date. Runs are joined with spaces, so a date split across runs still reads. */
const WEEK_ENDING = /\bWeek\s*Ending\s*:?\s*(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{4})(?!\d)/gi;

/** Runs whose baselines lie within this many points are one printed line. On the measured sheet the
 *  label and its date share a baseline exactly, and printed lines are about 18 points apart. */
const SAME_LINE_PT = 3;

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
    'September', 'October', 'November', 'December'];

/**
 * Every `Week Ending: DD/MM/YYYY` one page's text runs carry, wherever on the page they sit.
 * @param {Array<{ str?: any, x?: number, y?: number }>} runs   pdfjs text items, flattened
 * @returns {Array<{ printed: string, iso: string|null }>}  `iso` is null unless the date is a real Saturday
 */
function weekEndingsOnPage(runs) {
    /** @type {Array<{ y: number, runs: Array<{ s: string, x: number }> }>} */
    const lines = [];
    for (const r of Array.isArray(runs) ? runs : []) {
        if (!r || typeof r !== 'object' || !Number.isFinite(r.x) || !Number.isFinite(r.y)) continue;
        const s = String(r.str ?? '').trim();
        if (!s) continue;
        let line = lines.find(l => Math.abs(l.y - /** @type {number} */ (r.y)) < SAME_LINE_PT);
        if (!line) lines.push(line = { y: /** @type {number} */ (r.y), runs: [] });
        line.runs.push({ s, x: /** @type {number} */ (r.x) });
    }
    /** @type {Array<{ printed: string, iso: string|null }>} */
    const found = [];
    for (const line of lines) {
        const text = line.runs.sort((p, q) => p.x - q.x).map(r => r.s).join(' ');
        for (const m of text.matchAll(WEEK_ENDING)) {
            const iso = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
            found.push({ printed: `${m[1]}/${m[2]}/${m[3]}`, iso: isValidIsoDate(iso) && isoDayOfWeek(iso) === 6 ? iso : null });
        }
    }
    return found;
}

/** "Saturday 5 September 2026" — the app's date style, from an ISO date. @param {string} iso */
function longDate(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return `${DAY_NAMES[isoDayOfWeek(iso)]} ${d} ${MONTH_NAMES[m - 1]} ${y}`;
}

/**
 * Is the sheet for the week chosen?
 * @param {{ weekEndings?: Array<{ printed: string, iso: string|null }>, reason?: string,
 *           pagesRead?: number, pagesRejected?: number }|null|undefined} geometry
 *   the grid read, which gathers the headings from every page with text, grid or not
 * @param {string} weekEnding  the X-Week-Ending the handler has validated as a Saturday
 * @returns {{ status: 'match'|'mismatch'|'unread', note: string, message?: string, sheetWeek?: string }}
 *   `note` is for the log; `message` is the admin's sentence, on a mismatch only
 */
function checkSheetWeek(geometry, weekEnding) {
    const headings = geometry && Array.isArray(geometry.weekEndings) ? geometry.weekEndings : [];
    const weeks = [...new Set(headings.map(h => h.iso).filter(Boolean))];
    if (!weeks.length) {
        const textRead = !!geometry && ((geometry.pagesRead || 0) + (geometry.pagesRejected || 0)) > 0;
        const why = headings.length ? `its heading's date (${headings.map(h => h.printed).join(', ')}) is not a Saturday`
            : textRead ? 'the PDF prints no "Week Ending: DD/MM/YYYY" heading'
            : `the PDF's text was not read (${(geometry && geometry.reason) || 'no text'})`;
        return { status: 'unread', note: `the sheet's own week was not checked: ${why} — the read goes on without it` };
    }
    if (weeks.every(w => w === weekEnding)) {
        return { status: 'match', sheetWeek: weekEnding, note: `the sheet's own week is the week chosen, ending ${weekEnding}` };
    }
    const message = weeks.length === 1
        ? `This roster is for the week ending ${longDate(weeks[0])}, but the week chosen is ${longDate(weekEnding)}. `
            + 'Choose the matching week and upload it again.'
        : `This PDF holds rosters for more than one week — the weeks ending ${weeks.map(longDate).join(' and ')}. `
            + 'Upload one week\'s roster at a time.';
    return { status: 'mismatch', sheetWeek: weeks[0], message,
        note: `REFUSED: the sheet says week ending ${weeks.join(' and ')}, but the week chosen ends ${weekEnding}` };
}

module.exports = { weekEndingsOnPage, checkSheetWeek };
