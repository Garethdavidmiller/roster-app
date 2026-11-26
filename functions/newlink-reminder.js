'use strict';

/**
 * functions/newlink-reminder.js — the ONE push telling the New link page's audience to look at the three proposals
 * before the vote (owner, 26 Nov 2026: "a notification letting people know to check out new links before voting
 * starts"). WHO it reaches, the targeted send, and WHEN — its own date-guarded schedule
 * (`buildNewlinkVoteReminderNotification`), wired in index.js because documents.js is held to its size.
 *
 * ── THE NEW LINK PAGE'S OWN AUDIENCE, NOBODY ELSE ────────────────────────────────────────────────────────────────
 *
 * The page is for colleagues on a normal CEA contract, the managers and the admin (`canOpenNewlink`, auth-policy.js);
 * a CEA on a bilingual contract keeps their own links and a Dispatcher has none. So it is a TARGETED send, like the
 * pay reminder: a broadcast would send a bilingual-contract CEA, a Dispatcher or an Other Staff login to a page that
 * turns them away. The list is the server-owned `newlinkAudience` in roster-members.json, generated from
 * `canOpenNewlink` itself (scripts/generate-roster-members.mjs) — never a request, and never a second rule here.
 *
 * FAILS CLOSED, as the pay reminder does: an unresolved account is skipped, and no uids sends nothing.
 *
 * ── ONCE, EVEN IF THE SCHEDULE RUNS TWICE ────────────────────────────────────────────────────────────────────────
 *
 * The date guard says WHICH evening; it cannot say whether this evening has already sent. A scheduled run can be
 * delivered more than once, and two runs on the date would ring every phone twice — a second notice with the same
 * tag still alerts, because the service worker sets `renotify` (external review of v26.92). So the send is CLAIMED
 * first: one record, `oneOffPushes/newlink-vote-2026`, created in a transaction that refuses when it exists, as
 * Overtime claims its deadline reminder (functions/overtime.js). The claim is an ATTEMPT and comes before the send;
 * what the send reached is written to the record AFTER it, so "claimed" never reads as "delivered", and a send that
 * reached no device says so. A run that cannot reach Firestore to claim sends nothing: a missed nudge is better
 * than a doubled one. To send again on purpose, delete the record and fire the function by hand.
 */

const { onSchedule }       = require('firebase-functions/v2/scheduler');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { buildPushPayload } = require('./push-notices');   // the builder's own module, as a new sender should import it
const { setupWebPush, sendTargetedPush } = require('./push');
const { uidForMember } = require('./pay-reminder');

/** The one evening it goes, at 18:00 London (owner, 26 Nov 2026). Month 0-based. A date guard, as the timetable
 *  reminder has, so a function left deployed cannot fire again on some later 26 November. */
const NEWLINK_VOTE_REMINDER_DAY = Object.freeze({ year: 2026, month: 10, day: 26 });

/** Where the one send is claimed and its outcome kept. Server only: firestore.rules refuses every client. */
const NEWLINK_VOTE_SEND_RECORD = Object.freeze({ collection: 'oneOffPushes', id: 'newlink-vote-2026' });

/** The words (owner, 26 Nov 2026; the body trimmed of "the … page" to the 80-character budget). */
const NEWLINK_VOTE_REMINDER_BODY = 'Have a look at the three proposals before voting starts. Tap to open New link.';

/**
 * The names the reminder is addressed to. No list is said in the log, not guessed — and never "everyone".
 * @param {Record<string, any>|null|undefined} roster  roster-members.json
 * @returns {string[]}
 */
function newlinkReminderMembers(roster) {
    if (!roster || !Array.isArray(roster.newlinkAudience)) {
        console.warn('[newlinkVote] the server roster has no "newlinkAudience" list — nobody is reminded');
        return [];
    }
    return [...new Set(roster.newlinkAudience.filter((n) => typeof n === 'string' && n))];
}

/**
 * Send the reminder to the devices of the New link page's audience.
 * @param {{ roster: Record<string, any>, vapidPrivate: any, vapidPublic: string, STAFF_SITE_URL: string }} o
 * @returns {Promise<{ addressed: number, resolved: number, accepted: number }>} names, accounts found, and
 *          subscriptions that accepted it
 */
async function sendNewlinkVoteReminder({ roster, vapidPrivate, vapidPublic, STAFF_SITE_URL }) {
    const names = newlinkReminderMembers(roster);
    const uids  = (await Promise.all(names.map(uidForMember))).filter(/** @returns {u is string} */ (u) => Boolean(u));
    setupWebPush(vapidPrivate, vapidPublic);
    const accepted = await sendTargetedPush(buildPushPayload({
        feature: 'newlink',
        body:    NEWLINK_VOTE_REMINDER_BODY,
        url:     `${STAFF_SITE_URL}/newlink.html`,
    }), uids, '[newlinkVote]');
    console.log(`[newlinkVote] New link reminder — ${uids.length} of ${names.length} member(s) resolved, ${accepted} subscription(s) accepted`);
    return { addressed: names.length, resolved: uids.length, accepted };
}

/**
 * Claim the one send: true for the run that creates the record, false for any run after it. Throws when Firestore
 * cannot be reached, and the caller then sends nothing.
 * @param {any} db
 * @returns {Promise<boolean>}
 */
async function claimNewlinkVoteSend(db) {
    const ref = db.collection(NEWLINK_VOTE_SEND_RECORD.collection).doc(NEWLINK_VOTE_SEND_RECORD.id);
    return db.runTransaction(async (/** @type {any} */ tx) => {
        const snap = await tx.get(ref);
        if (snap.exists) return false;
        tx.set(ref, { claimedAt: FieldValue.serverTimestamp(), outcome: 'claimed' });
        return true;
    });
}

/**
 * Write what the claimed send reached, beside the claim. Never throws: the send has happened either way.
 * @param {any} db
 * @param {Record<string, any>} outcome
 */
async function recordNewlinkVoteOutcome(db, outcome) {
    try {
        await db.collection(NEWLINK_VOTE_SEND_RECORD.collection).doc(NEWLINK_VOTE_SEND_RECORD.id)
            .update({ ...outcome, finishedAt: FieldValue.serverTimestamp() });
    } catch (err) {
        console.error('[newlinkVote] the send ran, but its outcome could not be recorded:', err);
    }
}

/**
 * The scheduled function: daily at 18:00 London, and it sends on NEWLINK_VOTE_REMINDER_DAY alone. Built here rather
 * than in documents.js, which is held to its size, from the same pieces index.js hands that builder.
 * @param {{ REGION: string, VAPID_PRIVATE_KEY: any, VAPID_PUBLIC_KEY: string, STAFF_SITE_URL: string,
 *           rosterMembers: Record<string, any>, nowInLondon: () => { year: number, month: number, day: number } }} deps
 */
function buildNewlinkVoteReminderNotification({ REGION, VAPID_PRIVATE_KEY, VAPID_PUBLIC_KEY, STAFF_SITE_URL, rosterMembers, nowInLondon }) {
    return onSchedule({ schedule: '0 18 * * *', timeZone: 'Europe/London', region: REGION, secrets: [VAPID_PRIVATE_KEY] }, async () => {
        try {
            const { year, month, day } = nowInLondon();
            const d = NEWLINK_VOTE_REMINDER_DAY;
            if (year !== d.year || month !== d.month || day !== d.day) {
                console.log('[newlinkVote] Not the reminder evening — skipping');
                return;
            }
            const db = getFirestore();
            if (!(await claimNewlinkVoteSend(db))) {
                console.log('[newlinkVote] Already claimed by an earlier run — not sending again');
                return;
            }
            let sent;
            try {
                sent = await sendNewlinkVoteReminder({ roster: rosterMembers, vapidPrivate: VAPID_PRIVATE_KEY,
                    vapidPublic: VAPID_PUBLIC_KEY, STAFF_SITE_URL });
            } catch (err) {
                await recordNewlinkVoteOutcome(db, { outcome: 'failed' });
                throw err;
            }
            await recordNewlinkVoteOutcome(db, { ...sent, outcome: sent.accepted > 0 ? 'sent' : 'reached no device' });
        } catch (err) {
            console.error('[newlinkVote] Unhandled error:', err);
            throw err;
        }
    });
}

module.exports = { NEWLINK_VOTE_REMINDER_DAY, NEWLINK_VOTE_REMINDER_BODY, NEWLINK_VOTE_SEND_RECORD, newlinkReminderMembers, sendNewlinkVoteReminder,
    buildNewlinkVoteReminderNotification };
