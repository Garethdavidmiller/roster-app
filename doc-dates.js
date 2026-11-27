// @ts-check
/**
 * doc-dates.js — the date of the latest Daily Huddle, Weekly Retail Circular and Marylebone Newsletter, as this
 * device last heard it, for the ☰ menu (owner, 27 Nov 2026: "show the issue date in the menu before opening the
 * document, so staff can tell whether it's the one they've already read").
 *
 * ── WHERE EACH DATE COMES FROM ───────────────────────────────────────────────────────────────────
 *
 * Nothing here reads the server on its own. The Newsletter's date is newsletter-recency.js's, which already
 * keeps it (that module decides whether the row shows at all; this one only words it). The Huddle's is what
 * the Calendar's own Huddle listener delivers (calendar-huddle-viewer.js), and the Circular's what the
 * Calendar's once-a-load check reads (`checkLatestCircular`, the Newsletter check's twin), so every page's
 * drawer shows the dates the Calendar last heard. A device that has never heard shows no date: a date this
 * device does not know is never guessed.
 *
 * ── WHAT A DATE MEANS ────────────────────────────────────────────────────────────────────────────
 *
 * A Huddle's date is the day it plans — it is sent the evening before — so it reads "for Fri 28 Nov". A
 * Circular's or Newsletter's is its issue date, "Fri 27 Nov". Another year's date carries its year.
 *
 * Pure apart from `ls.js` (and newsletter-recency.js's store); the read is handed in. Tested by
 * doc-dates.test.mjs.
 */
import { lsGet, lsSet } from './ls.js';
import { latestNewsletterDate } from './newsletter-recency.js';
import { formatWeekdayDate } from './date-format.js';

/** Where this device keeps each latest date ('' once the server has said there is none). Device-level:
 *  the documents are the same whoever is signed in. */
export const DOC_DATE_KEYS = Object.freeze({ huddle: 'myb_huddle_latest', circular: 'myb_circular_latest' });

/** This page's copies, for a device whose storage refuses them. @type {Record<string, string>} */
const _memo = {};

/**
 * Keep the latest Huddle's or Circular's date as the server gave it.
 * @param {'huddle'|'circular'} kind @param {unknown} issueDate 'YYYY-MM-DD', or null when there is none
 */
export function recordDocDate(kind, issueDate) {
    const value = typeof issueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(issueDate) ? issueDate : '';
    _memo[kind] = value;
    lsSet(DOC_DATE_KEYS[kind], value);
}

/** The latest date this device knows for a kind, or '' when none. @param {'huddle'|'circular'|'newsletter'} kind @returns {string} */
export function docDate(kind) {
    if (kind === 'newsletter') return latestNewsletterDate() ?? '';
    return _memo[kind] ?? lsGet(DOC_DATE_KEYS[kind]) ?? '';
}

/**
 * The menu's words for a date: "for Fri 28 Nov" (a Huddle), "Fri 27 Nov" (an issue), with the year when it is
 * not this year's; '' when this device does not know it.
 * @param {'huddle'|'circular'|'newsletter'} kind @param {Date} [now]
 * @returns {string}
 */
export function docDateLabel(kind, now = new Date()) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(docDate(kind));
    if (!m) return '';
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (d.getMonth() !== Number(m[2]) - 1) return '';
    const words = formatWeekdayDate(d, d.getFullYear() !== now.getFullYear());
    return kind === 'huddle' ? `for ${words}` : words;
}

/**
 * Ask the server for the latest Circular's date and keep it — the Newsletter check's twin. Waits for `ready`,
 * asks nothing while the documents are shut, and never rejects: a failed read keeps what the device knew.
 * @param {{ ready: Promise<any>, canRead: () => boolean, fetchLatest: () => Promise<any> }} deps
 */
export async function checkLatestCircular({ ready, canRead, fetchLatest }) {
    try {
        await ready;
        if (!canRead()) return;
        const latest = await fetchLatest();
        recordDocDate('circular', latest?.date ?? null);
    } catch (err) {
        console.warn('[circular] could not check the latest issue; the ☰ menu keeps the date this device knew', /** @type {any} */ (err)?.code ?? err);
    }
}
