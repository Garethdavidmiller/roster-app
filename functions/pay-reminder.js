'use strict';

/**
 * functions/pay-reminder.js — WHO the four-weekly pay reminder reaches, and the targeted send.
 * The schedule that decides WHEN stays in documents.js (`sendPayReminderNotification`).
 *
 * ── CEA AND CES MEMBERS, NOBODY ELSE (owner decision, 10 November 2026) ─────────────────────────
 *
 * "Open the Pay Calculator to estimate your pay" invites the reader to a page that prices only the
 * grades `gradeForRole` (roster-data.js) knows. As a broadcast it reached every Dispatcher and
 * manager with notifications on, and each tap landed on the card saying the calculator does not
 * cover their pay — though .claude/rules/paycalc.md invariant 13 says nothing sends such a member
 * there, and the Calendar's own payday notice already asks the same question (`payCalcIsTheirs`,
 * calendar-notices.js). So it is a TARGETED send, by owner uid, like the Overtime notices.
 *
 * The audience comes from the SERVER-owned roster — `cea` and `ces` in roster-members.json, each
 * grade's visible members, the same lists `getMembersForGrade` gives the client — never a request.
 * The grade keys are spelt as `gradeForRole` answers, and documents-endpoints.test.mjs takes its
 * expected audience from `gradeForRole` itself, so pricing another grade on the client without
 * adding it here fails a test instead of silently missing those members.
 *
 * FAILS CLOSED, per member and as a whole: a member whose account cannot be resolved is skipped,
 * and `sendTargetedPush` sends nothing at all for no uids — never "everyone".
 */

const { getAuth } = require('firebase-admin/auth');
const { nameToEmail, buildPushPayload } = require('./roster-parse-helpers');
const { setupWebPush, sendTargetedPush } = require('./push');
const { isViewerAccount } = require('./calendar-viewer-auth');

/** The roster-members.json keys the reminder is addressed to — `gradeForRole`'s non-null answers. */
const PAY_REMINDER_GRADES = Object.freeze(['cea', 'ces']);

/**
 * The names the pay reminder is addressed to. A grade with no list is said in the log, not guessed.
 * @param {Record<string, any>|null|undefined} roster  roster-members.json
 * @returns {string[]}
 */
function payReminderMembers(roster) {
    const names = PAY_REMINDER_GRADES.flatMap((grade) => {
        if (roster && Array.isArray(roster[grade])) return roster[grade];
        console.warn(`[payReminder] the server roster has no "${grade}" list — its members are not reminded`);
        return [];
    });
    return [...new Set(names.filter((n) => typeof n === 'string' && n))];
}

/**
 * A member's Auth uid, from the account their name derives to — the derivation setupRosterAuth
 * provisions with, and the one the Overtime notices resolve through. Any failure is `null`, and that
 * member is skipped. The shared Calendar PIN account is refused even when a PIN holder has linked a
 * roster email to it: the devices it owns are the station's shared PCs, not the member's phone.
 * @param {string} name
 * @returns {Promise<string|null>}
 */
async function uidForMember(name) {
    try {
        const user = await getAuth().getUserByEmail(nameToEmail(name));
        return user && user.uid && !isViewerAccount(user) ? user.uid : null;
    } catch (_) {
        return null;
    }
}

/**
 * Send the reminder for `payday` to the devices of CEA and CES members. The deep link carries
 * ?payday=YYYY-MM-DD so the Pay Calculator opens on the right period. `STAFF_SITE_URL` keeps its
 * name on purpose: sw-asset-check.test.mjs finds a call-time deep link by that spelling, and checks
 * its page is one the service worker will open.
 * @param {{ payday: Date, roster: Record<string, any>, vapidPrivate: any,
 *           vapidPublic: string, STAFF_SITE_URL: string }} o
 * @returns {Promise<number>} subscriptions that accepted it
 */
async function sendPayReminder({ payday, roster, vapidPrivate, vapidPublic, STAFF_SITE_URL }) {
    // toISOString (UTC): the caller builds payday at NOON UTC from London calendar parts, so the UTC
    // date is the London date on any runtime timezone.
    const paydayISO = payday.toISOString().slice(0, 10);
    const paydayDay = payday.toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'Europe/London' });
    const paydayFmt = payday.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'Europe/London' });

    const names = payReminderMembers(roster);
    const uids  = (await Promise.all(names.map(uidForMember))).filter(Boolean);

    setupWebPush(vapidPrivate, vapidPublic);
    // Event-reminder grammar (.claude/rules/notifications.md): "💷 <Event> — <urgency>",
    // calm/no-exclamation tone, action in the body.
    const accepted = await sendTargetedPush(buildPushPayload({
        feature:  'pay',
        headline: `Payday ${paydayDay} — hours cutoff today`,
        body:     `Open the Pay Calculator to estimate your ${paydayFmt} pay.`,
        url:      `${STAFF_SITE_URL}/paycalc.html?payday=${paydayISO}`,
    }), uids, '[payReminder]');
    console.log(`[payReminder] Pay reminder for payday ${paydayISO} — ${uids.length} of ${names.length} CEA/CES member(s) resolved, ${accepted} subscription(s) accepted`);
    return accepted;
}

module.exports = { PAY_REMINDER_GRADES, payReminderMembers, sendPayReminder };
