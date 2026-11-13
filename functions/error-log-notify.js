'use strict';

/**
 * functions/error-log-notify.js — tell the ADMIN's devices when new entries have reached the Error Log
 * (v26.04). documents.js runs it every fifteen minutes (`sendErrorLogNotification`), as it runs the pay
 * reminder whose send is ./pay-reminder.js. The RULES — what counts as new, what the notice says, when
 * one may be sent — are ./error-log-notice.js, pure and tested apart; this file reads, sends and keeps
 * the record.
 *
 * ── WHY A SCHEDULE, NOT A TRIGGER ON EACH ENTRY ──────────────────────────────────────────────────
 *
 * `clientErrors` is written by every signed-in member and by the staff-PIN viewer. A trigger would run
 * a Cloud Function for EVERY entry, so somebody filling the log would add a function call to each write;
 * a check every fifteen minutes costs the same whatever arrives. The price is up to fifteen minutes
 * before the phone rings, which an Error Log can afford.
 *
 * ── WHO IS TOLD ──────────────────────────────────────────────────────────────────────────────────
 *
 * The ADMIN only: roster-members.json `roles.admin`, today the owner alone ("only for my login the
 * master admin", 13 Nov 2026). Never a manager, who cannot open the Error Log. Each name is resolved to
 * its account, and the account must be enabled and carry the `admin` claim or it is dropped: an account
 * Set up accounts has not made an admin is not told about a log it cannot read. No account left sends
 * nothing — `sendTargetedPush` never widens.
 *
 * ── THE RECORD: errorLogNotice/state ─────────────────────────────────────────────────────────────
 *
 *   announcedThrough  the timestamp of the last entry a notice that REACHED a device covered (rule 2).
 *                     The entry's OWN Timestamp, never one rebuilt from milliseconds: Firestore keeps
 *                     microseconds, so a line rounded down to the millisecond would find the same entry
 *                     "new" again, and the admin would be told about it every hour for ever.
 *   lastAttemptAt     when the last notice was attempted (rule 1).
 *
 * One edge the line cannot close: an entry's timestamp is when its write ARRIVED, so a write still
 * committing at the moment of a check can carry a time just before an entry the check already saw, and
 * the line then passes it uncounted. That can only happen beside an entry that WAS seen, so the notice
 * still goes; it can undercount by a few milliseconds' worth of arrivals, never stay silent while the
 * log grows, and the entry itself is in the Error Log.
 *
 * Server only: firestore.rules refuses every client read and write of `errorLogNotice`.
 */

const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { nameToEmail } = require('./roster-parse-helpers');
const { buildPushPayload } = require('./push-notices');
const { setupWebPush, sendTargetedPush } = require('./push');
const { noticeDue, summariseNewEntries, noticeWords, NOTICE_SCAN_LIMIT } = require('./error-log-notice');

/** @param {any} t a Firestore Timestamp, or anything else @returns {number|null} */
const toMs = (t) => (t && typeof t.toMillis === 'function' ? t.toMillis() : null);
/** The record as the pure rule reads it. @param {any} data */
const asState = (data) => (data ? { announcedThroughMs: toMs(data.announcedThrough), lastAttemptMs: toMs(data.lastAttemptAt) } : null);

/**
 * The accounts that may be told: an admin name's own account, enabled, carrying the `admin` claim.
 * @param {string[]|undefined} names  roster-members.json roles.admin
 * @returns {Promise<string[]>} uids
 */
async function adminUids(names) {
    const uids = [];
    for (const name of names || []) {
        try {
            const user = await getAuth().getUserByEmail(nameToEmail(name));
            if (user && user.uid && !user.disabled && user.customClaims && user.customClaims.admin === true) uids.push(user.uid);
            else console.warn('[errorLog] not an enabled admin account, so not told:', name);
        } catch (e) {
            console.warn('[errorLog] could not resolve the admin account for', name, e && e.code);
        }
    }
    return uids;
}

/**
 * One check: seed the record, wait out the hour, or count what is new and tell the admin.
 * @param {{ vapidPrivate: any, vapidPublic: string, STAFF_SITE_URL: string, roster: any, now?: () => number }} o
 * @returns {Promise<{ outcome: 'seeded'|'wait'|'nothing new'|'all resolved'|'claimed elsewhere'|'sent'|'unreached', accepted?: number }>}
 */
async function notifyAdminOfErrorLog({ vapidPrivate, vapidPublic, STAFF_SITE_URL, roster, now = Date.now }) {
    const db = getFirestore();
    const ref = db.collection('errorLogNotice').doc('state');
    const snap = await ref.get();
    const state = snap.exists ? snap.data() : null;
    const due = noticeDue(asState(state), now());
    if (due === 'seed') {
        // Rule 6: the backlog is not news. `set`, not a merge: a record missing its line starts again whole.
        await ref.set({ announcedThrough: FieldValue.serverTimestamp(), lastAttemptAt: null });
        console.log('[errorLog] first check: the line starts now, and nothing is sent');
        return { outcome: 'seeded' };
    }
    if (due === 'wait') return { outcome: 'wait' };

    const page = await db.collection('clientErrors')
        .where('timestamp', '>', state.announcedThrough)
        .orderBy('timestamp')
        .limit(NOTICE_SCAN_LIMIT + 1)
        .get();
    const summary = summariseNewEntries(page.docs.map((d) => d.data()));
    if (summary.examined === 0) return { outcome: 'nothing new' };
    // The entry's own Timestamp (the header says why never a rebuilt one).
    const through = page.docs[summary.examined - 1].data().timestamp;
    const words = noticeWords(summary);
    if (!words) {
        // Rule 3: every new entry is already resolved. Nothing to tell, and never look at them again.
        await ref.update({ announcedThrough: through });
        return { outcome: 'all resolved' };
    }

    // Rule 1, asked again INSIDE a transaction that stamps the attempt: two checks that overlap read the
    // record one at a time, so only one of them rings the phone.
    const claimed = await db.runTransaction(async (tx) => {
        const fresh = await tx.get(ref);
        if (noticeDue(asState(fresh.exists ? fresh.data() : null), now()) !== 'look') return false;
        tx.update(ref, { lastAttemptAt: FieldValue.serverTimestamp() });
        return true;
    });
    if (!claimed) return { outcome: 'claimed elsewhere' };

    const uids = await adminUids(roster && roster.roles && roster.roles.admin);
    let accepted = 0;
    if (uids.length > 0) {
        setupWebPush(vapidPrivate, vapidPublic);
        accepted = await sendTargetedPush(buildPushPayload({
            feature:  'errorLog',
            headline: words.headline,
            body:     words.body,
            url:      `${STAFF_SITE_URL}/operations.html#error-log`,
        }), uids, '[errorLog]');
    }
    console.log(`[errorLog] ${summary.errors} error(s), ${summary.slowSaves} slow save(s)${summary.more ? `, more than ${NOTICE_SCAN_LIMIT} in all` : ''}; ${accepted} device(s) accepted`);
    // Rule 2: only a notice that reached a device moves the line.
    if (accepted > 0) {
        await ref.update({ announcedThrough: through });
        return { outcome: 'sent', accepted };
    }
    console.warn('[errorLog] the notice reached no device: the same entries are counted again in an hour');
    return { outcome: 'unreached', accepted: 0 };
}

module.exports = { notifyAdminOfErrorLog };
