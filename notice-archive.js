// @ts-check
/**
 * notice-archive.js — the App Notices archive: what a one-time notice leaves behind once it has been
 * seen, how long it is kept, and when a notice is too old to show at all.
 *
 * Moved out of nav-panel.js (Nov 2026), where coordinator-ratchet.test.mjs had named it as that file's
 * seam: these are RULES — what the archive holds, for how long, how a legacy record migrates, how a
 * posting date is counted — and the drawer only renders them. The pages that archive a notice import
 * the two calls from here (nav-panel.js re-exported them until Nov 2026, which nothing needs now). The archive is
 * this DEVICE's storage, which Safari wipes and an installed app keeps separately, so an empty archive
 * says nothing about whether notices were posted. Imports only `ls.js`, so it loads in Node.
 */
import { lsGet, lsSet } from './ls.js';

/** localStorage key for the archived notices list. */
const NOTICES_KEY = 'myb_app_notices';
/** Archive entries older than this are pruned from localStorage. */
const ARCHIVE_EXPIRY_DAYS = 180;
/** The archive keeps the newest this many. */
const ARCHIVE_MAX = 50;

const _MONTHS = { Jan:0, Feb:1, Mar:2, Apr:3, May:4, Jun:5, Jul:6, Aug:7, Sep:8, Oct:9, Nov:10, Dec:11 };
/** @param {any} str */
function _parseNoticeDate(str) {
    const [d, mon, y] = str.trim().split(/\s+/);
    const m = /** @type {Record<string, any>} */ (_MONTHS)[mon];
    return (m === undefined) ? NaN : new Date(+y, m, +d).getTime();
}

const _MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September',
                     'October', 'November', 'December'];

/**
 * A notice's posting date as the app writes a date with its year: the month in full ("22 October 2026",
 * the house style since v26.53). DISPLAY ONLY (App Notices review, 24 Nov 2026): the stored date stays
 * "D Mon YYYY", because it is also the notice's expiry key and `_parseNoticeDate` reads only that form —
 * respelt there, `isNoticeExpired('16 November 2026', 1)` is false for ever and the notice never ends.
 * Anything it cannot read comes back as it was given.
 * @param {string} dateStr  "D Mon YYYY"
 * @returns {string}
 */
export function noticeDateInFull(dateStr) {
    const posted = _parseNoticeDate(String(dateStr ?? ''));
    if (isNaN(posted)) return dateStr ?? '';
    const d = new Date(posted);
    return `${d.getDate()} ${_MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
}

/**
 * Returns true if a notice's posting date is older than the given number of days.
 * Use to silently dismiss stale notices on a new device:
 *   if (isNoticeExpired(NOTICE_DATE))     { lsSet(DONE_KEY, '1'); return; }  // 28-day (default)
 *   if (isNoticeExpired(NOTICE_DATE, 90)) { lsSet(DONE_KEY, '1'); return; }  // 90-day (long)
 * @param {string} dateStr - "D Mon YYYY", e.g. "22 Jun 2026"
 * @param {number} [days=28] - expiry window: 28 for short-range, 90 for long-range
 */
export function isNoticeExpired(dateStr, days = 28) {
    const posted = _parseNoticeDate(dateStr);
    return !isNaN(posted) && (Date.now() - posted) > days * 86_400_000;
}

/**
 * Archive a notice so it appears in the App Notices panel.
 * Call this when the user dismisses a notice lightbox.
 * Entries older than ARCHIVE_EXPIRY_DAYS (180) are pruned automatically.
 * @param {{ id: string, title: string, section: string, date: string, body: string }} notice
 */
export function archiveNotice({ id, title, section, date, body }) {
    try {
        const expiryMs = ARCHIVE_EXPIRY_DAYS * 86_400_000;
        const now    = Date.now();
        const nowIso = new Date(now).toISOString();

        // Parse defensively — malformed or non-array stored data must not stop a new
        // notice being saved (it just starts a fresh archive).
        let parsed;
        try { parsed = JSON.parse(lsGet(NOTICES_KEY) || '[]'); } catch { parsed = []; }
        const records = Array.isArray(parsed) ? parsed : [];

        const kept = records
            // Drop non-object members first: a null/garbage element would otherwise become
            // `{ ...null, archivedAt }` = a content-less record that survives the expiry filter
            // and later renders as a blank App Notices card (v16.19).
            .filter(n => n && typeof n === 'object')
            // Migrate legacy pre-v13.41 records (no archivedAt) by stamping them with
            // `now` instead of dropping them — otherwise the first archive write after
            // an upgrade would silently wipe the user's whole notice history.
            .map(n => n.archivedAt ? n : { ...n, archivedAt: nowIso })
            .filter(n => {
                const t = new Date(n.archivedAt).getTime();
                return Number.isFinite(t) && (now - t) < expiryMs;
            });

        // A RE-POST REPLACES ITS OLD RECORD (whole-app review, 10 Nov 2026). The same id with a
        // DIFFERENT posting date is the notice run again — the Pay Calculator's Year to Date notice
        // ran from 6 Apr and again from 28 Aug under one id — and keeping the first record left App
        // Notices showing the first run's date and words, aged out 180 days from the FIRST dismissal.
        // The same id and date stays idempotent: a notice may archive on every showing, and that must
        // not refresh its age or move it to the top.
        const existing = kept.filter(n => n.id !== id || n.date === date);
        if (!existing.some(n => n.id === id)) {
            existing.unshift({ id, title, section, date, body, archivedAt: nowIso });
        }
        // Always write back so the legacy migration and expiry pruning persist even on
        // the idempotent path (the same notice id archived again).
        lsSet(NOTICES_KEY, JSON.stringify(existing.slice(0, ARCHIVE_MAX)));
    } catch (e) {
        console.warn('[Nav] archiveNotice failed:', e);
    }
}

/**
 * Put corrected words on a notice ALREADY in this device's archive — the same id and date — keeping its
 * place and its age. For words that went out of date while the record is still listed (App Notices
 * review, 24 Nov 2026): "the new timetable starts on Sunday 13 December" is wrong from that Sunday, and
 * the archive keeps a record for 180 days. `archiveNotice` cannot do it, because the same id and date
 * is deliberately idempotent there. A device that never archived the notice gets nothing; one whose
 * record already says this writes nothing. Never throws.
 * @param {{ id: string, date: string, title: string, body: string }} notice
 */
export function reviseArchivedNotice({ id, date, title, body }) {
    try {
        const parsed = JSON.parse(lsGet(NOTICES_KEY) || '[]');
        if (!Array.isArray(parsed)) return;
        let changed = false;
        const revised = parsed.map(n => {
            if (!n || typeof n !== 'object' || n.id !== id || n.date !== date) return n;
            if (n.title === title && n.body === body) return n;
            changed = true;
            return { ...n, title, body };
        });
        if (changed) lsSet(NOTICES_KEY, JSON.stringify(revised));
    } catch (e) {
        console.warn('[Nav] reviseArchivedNotice failed:', e);
    }
}

/**
 * The archive as the App Notices panel lists it, newest first. Never throws: unreadable storage, or
 * valid JSON that is not an array (`{}` from corruption), reads as an empty archive — a non-array
 * passed JSON.parse once and then broke the panel with a TypeError on `forEach` (v16.21). A list
 * holding a `null` or a bare value reads without it, for the same reason one level down: the panel
 * reads each entry's fields, and `archiveNotice` drops such members on its next write anyway.
 * @returns {any[]}
 */
export function readArchivedNotices() {
    try {
        const p = JSON.parse(lsGet(NOTICES_KEY) || '[]');
        const now = Date.now(), expiryMs = ARCHIVE_EXPIRY_DAYS * 86_400_000;
        // ONE AGE LIMIT FOR READING AND WRITING (review, 21 Nov 2026): the write prunes, but a device that
        // archived nothing new went on listing a notice from 300 days ago. A record with no `archivedAt`
        // is a legacy one the next write stamps with today (above), so it is kept here too. One whose
        // `archivedAt` cannot be read is DROPPED here, as the next write drops it (24-hour check, 22 Nov
        // 2026): it was listed until then, and gone after, for no reason the reader could see.
        const fresh = (/** @type {any} */ n) => {
            if (!n.archivedAt) return true;
            const t = new Date(n.archivedAt).getTime();
            return Number.isFinite(t) && (now - t) < expiryMs;
        };
        return Array.isArray(p) ? p.filter(n => n && typeof n === 'object' && fresh(n)) : [];
    } catch (_) { return []; }
}
