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
 */

const { onSchedule }       = require('firebase-functions/v2/scheduler');
const { buildPushPayload } = require('./push-notices');   // the builder's own module, as a new sender should import it
const { setupWebPush, sendTargetedPush } = require('./push');
const { uidForMember } = require('./pay-reminder');

/** The one evening it goes, at 18:00 London (owner, 26 Nov 2026). Month 0-based. A date guard, as the timetable
 *  reminder has, so a function left deployed cannot fire again on some later 26 November. */
const NEWLINK_VOTE_REMINDER_DAY = Object.freeze({ year: 2026, month: 10, day: 26 });

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
 * @returns {Promise<number>} subscriptions that accepted it
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
    return accepted;
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
            await sendNewlinkVoteReminder({ roster: rosterMembers, vapidPrivate: VAPID_PRIVATE_KEY,
                vapidPublic: VAPID_PUBLIC_KEY, STAFF_SITE_URL });
        } catch (err) {
            console.error('[newlinkVote] Unhandled error:', err);
            throw err;
        }
    });
}

module.exports = { NEWLINK_VOTE_REMINDER_DAY, NEWLINK_VOTE_REMINDER_BODY, newlinkReminderMembers, sendNewlinkVoteReminder,
    buildNewlinkVoteReminderNotification };
