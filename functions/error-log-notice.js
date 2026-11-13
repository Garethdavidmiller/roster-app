'use strict';

/**
 * functions/error-log-notice.js — the RULES of the admin's Error Log notification (v26.04): which entries
 * count as new, what the notification says, and when one may be sent. Pure — no Firebase — so it is
 * tested in the no-install lane (error-log-notice.test.mjs). functions/error-log-notify.js asks it, and
 * does the reads, the send and the record.
 *
 * ── WHY IT EXISTS ─────────────────────────────────────────────────────────────────────────────────
 *
 * Owner, 13 Nov 2026: "Do the phone notification, only for my login the master admin". Until then the
 * Error Log told nobody anything. The Operations strip counts real errors only, so the slow-save
 * readings — the evidence the slow-iPhone-saves investigation is waiting for — arrived silently.
 *
 * ── THE RULES ─────────────────────────────────────────────────────────────────────────────────────
 *
 *   1. AT MOST ONE AN HOUR (`NOTICE_GAP_MS`), counted from the last ATTEMPT, not the last success. A
 *      burst — a bad release, or somebody filling the log on purpose — rings the phone once, and a send
 *      that reached no device is tried again an hour later, not every fifteen minutes.
 *   2. NEW MEANS AFTER THE LAST ENTRY A NOTICE REACHED A DEVICE WITH. The line moves only when a device
 *      accepted the notice, so nothing is lost to a phone that could not be reached: the next notice
 *      counts it again.
 *   3. ONLY UNRESOLVED ENTRIES ARE COUNTED. One the admin has already resolved has been read. It still
 *      moves the line, so it is never looked at again.
 *   4. A SLOW SAVE IS NAMED APART FROM AN ERROR. The Operations strip counts only errors; the notice
 *      announces both and says which is which, because the slow-save readings are the investigation's
 *      evidence and an error is a different kind of news.
 *   5. THE WORDS CARRY COUNTS AND NOTHING ELSE. A push renders on a LOCK SCREEN: no member's name, no
 *      page, no message text, ever. The Error Log is where those are read.
 *   6. THE FIRST CHECK SEEDS. With no record of a previous notice the line starts NOW: the backlog
 *      already in the log is not news, and "37 new" on the day this shipped would have been untrue.
 */

/** The client's spelling of a slow-save entry (client-errors.js → DIAGNOSTIC_PREFIX). Copied, not
 *  imported, because a Cloud Function cannot load a browser module; error-log-notice.test.mjs holds the
 *  two equal. */
const DIAGNOSTIC_PREFIX = 'Slow save (diagnostic)';

/** Rule 1: one notice an hour at most. */
const NOTICE_GAP_MS = 60 * 60 * 1000;

/** How many new entries one notice covers. The check reads one more, which PROVES "more than" — the
 *  same no-silent-caps pattern as the Error Log card's own read (getClientErrors). */
const NOTICE_SCAN_LIMIT = 100;

/** @param {unknown} message @returns {boolean} */
function isSlowSave(message) {
    return typeof message === 'string' && message.startsWith(DIAGNOSTIC_PREFIX);
}

/**
 * Rules 1 and 6: may a notice be considered now?
 * @param {{ announcedThroughMs: number|null, lastAttemptMs: number|null }|null} state  the record, in ms
 * @param {number} nowMs
 * @returns {'seed'|'wait'|'look'}  seed: no record yet — start the line now and send nothing;
 *   wait: a notice was attempted within the hour; look: read what is new
 */
function noticeDue(state, nowMs) {
    if (!state || !Number.isFinite(state.announcedThroughMs)) return 'seed';
    const last = state.lastAttemptMs;
    // |Δ|, not Δ: an attempt stamped a moment AHEAD of this clock still holds, and one far ahead (a
    // clock far out) holds for an hour of difference, never for ever — the reset-request claim's rule.
    if (Number.isFinite(last) && Math.abs(nowMs - /** @type {number} */ (last)) < NOTICE_GAP_MS) return 'wait';
    return 'look';
}

/**
 * Rules 2–4: what the entries after the line amount to.
 * @param {Array<{ message?: unknown, resolved?: unknown }>} entries  oldest first, at most
 *   NOTICE_SCAN_LIMIT + 1 of them (the extra one proves "more than")
 * @returns {{ errors: number, slowSaves: number, more: boolean, examined: number }}
 *   `examined` — how many of `entries` this notice covers; the line moves to the last of them
 */
function summariseNewEntries(entries) {
    const list = Array.isArray(entries) ? entries : [];
    const covered = list.slice(0, NOTICE_SCAN_LIMIT);
    let errors = 0;
    let slowSaves = 0;
    for (const e of covered) {
        if (!e || e.resolved === true) continue;   // rule 3
        if (isSlowSave(e.message)) slowSaves += 1; else errors += 1;
    }
    return { errors, slowSaves, more: list.length > NOTICE_SCAN_LIMIT, examined: covered.length };
}

/**
 * Rules 4 and 5: the notice's words — counts, and nothing a lock screen should not show.
 * @param {{ errors: number, slowSaves: number, more: boolean }} summary
 * @returns {{ headline: string, body: string }|null}  null when there is nothing to tell
 */
function noticeWords({ errors, slowSaves, more }) {
    const open = 'Tap to open the Error Log.';
    // A flood says so, unsplit: the counts cover only the first NOTICE_SCAN_LIMIT, and a split of part
    // of a flood would read as the whole of it.
    if (more) return { headline: `Error Log — ${NOTICE_SCAN_LIMIT}+ new`, body: `More than ${NOTICE_SCAN_LIMIT} new entries. ${open}` };
    const total = errors + slowSaves;
    if (!(total > 0)) return null;
    const parts = [];
    if (errors > 0) parts.push(`${errors} ${errors === 1 ? 'error' : 'errors'}`);
    if (slowSaves > 0) parts.push(`${slowSaves} ${slowSaves === 1 ? 'slow save' : 'slow saves'}`);
    return { headline: `Error Log — ${total} new`, body: `${parts.join(' and ')}. ${open}` };
}

module.exports = { DIAGNOSTIC_PREFIX, NOTICE_GAP_MS, NOTICE_SCAN_LIMIT, isSlowSave, noticeDue, summariseNewEntries, noticeWords };
