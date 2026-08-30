/**
 * functions/push.js — how this app puts a notification on a phone.
 *
 * Owns: the web-push transport. Lazy `web-push` require, one-per-instance VAPID setup, the two
 *   senders (`fanOutPush` to everyone, `sendTargetedPush` to named uids), and the dead-subscription
 *   cleanup both share.
 * Does NOT own: what any notification SAYS or when. Payloads come from `buildPushPayload`
 *   (roster-parse-helpers.js) against the design language in `.claude/rules/notifications.md`, and
 *   the decision to send at all stays with the feature in index.js.
 *
 * ── WHY IT IS ITS OWN FILE (v20.52, external review) ────────────────────────────────────────────
 * `functions/index.js` had reached 2,229 lines holding several unrelated domains, and the review's
 * point was that the NEXT feature should land in a domain module rather than pushing it toward
 * 3,000. This is the first cut, and it was chosen to be the safest possible one: these are internal
 * helpers only, so no `exports.<endpoint>` moved and the deployed function surface is byte-identical
 * in shape. Account administration, password recovery and the reset queue are the next candidates,
 * and each of those DOES move an endpoint — worth doing deliberately, one at a time, not in a sweep.
 *
 * ── THE TWO SENDERS ARE NOT INTERCHANGEABLE ─────────────────────────────────────────────────────
 * `fanOutPush` reaches every subscribed device. `sendTargetedPush` reaches only the uids it is
 * given and **fails closed at every step** — no uids, no owner stamp, no matches all mean "send
 * nothing", and there is deliberately no fall-back-to-everyone branch. That is not a performance
 * choice: the reset-request notice names a member who cannot get in, and broadcasting it to fifty
 * colleagues would be a leak. When adding a notification, ask whether every member should read it;
 * if not, it is targeted (`.claude/rules/notifications.md` → the checklist).
 *
 * Firestore is reached here rather than passed in: `getFirestore()` resolves the same default
 * app index.js initialised, so there is no second app and no init-order coupling.
 */

const { getFirestore } = require('firebase-admin/firestore');
const { shouldDeleteSubscription } = require('./roster-parse-helpers');

// Module-level flag so setVapidDetails() is only called once per warm instance.
// Secrets are not available at module init, so we defer to first call.
let _vapidConfigured = false;

// M8: web-push loaded on first push only (see the require note at the top). Cached after first use.
let _webpush = null;
/** @returns {any} the web-push module, required lazily on first use. */
function getWebPush() {
    if (!_webpush) _webpush = require('web-push');
    return _webpush;
}

/**
 * Configures web-push VAPID credentials once per process lifetime.
 *
 * The PUBLIC key is a parameter rather than a constant here, deliberately. It lives in
 * `functions/index.js` because `sw-asset-check.test.mjs` reads that file to assert it is identical
 * to the copy in `notif.js` — a mismatch is silent AND permanent (every existing subscription stops
 * receiving, with no error anywhere), so the guard is worth more than the tidiness of moving the
 * constant next to the code that uses it.
 *
 * @param {{ value: () => string }} vapidPrivate  the defineSecret handle, read at call time
 * @param {string} vapidPublic                    VAPID_PUBLIC_KEY from index.js
 */
function setupWebPush(vapidPrivate, vapidPublic) {
    if (_vapidConfigured) return;
    getWebPush().setVapidDetails(
        'mailto:noreply@myb-roster.web.app',
        vapidPublic,
        vapidPrivate.value(),
    );
    _vapidConfigured = true;
}

/**
 * Fan out Web Push notifications to all subscribed devices for a given JSON payload.
 * Dead subscriptions (HTTP 410/404 — genuinely gone) are deleted from Firestore. A 401 is a
 * VAPID-AUTH failure (server misconfig, not a dead endpoint) and is logged, NEVER deleted —
 * deleting on 401 would wipe the whole collection on any VAPID key error (v16.15).
 *
 * @param {object} payload   Object that will be JSON.stringify'd — must include title, body, url, tag
 * @param {string} logTag    Short string for console log lines, e.g. '[push]'
 */
/**
 * Send a Web Push payload to the devices of SPECIFIC identities only, never to everyone.
 *
 * This is the targeted counterpart to fanOutPush, and it exists because one notification in this app
 * is not a broadcast: "N. Surname asked for a password reset" is addressed to the admin, and sending
 * it to all ~50 staff would leak who is locked out to the entire team.
 *
 * **It FAILS CLOSED, on purpose, in three separate places**, because every failure mode here has the
 * same consequence — telling 50 people something meant for one:
 *   1. An empty/absent `ownerUids` sends NOTHING. There is deliberately no "no targets → fall back to
 *      everyone" branch; that fallback is the exact bug this function is shaped to make unwritable.
 *   2. A subscription doc with NO `owner` field is SKIPPED, never assumed to be the target's. Those
 *      are legacy docs written before v17.76 stamped the uid. The cost is real and accepted: an admin
 *      whose device subscribed before v17.76 gets no push until they toggle the bell off and on
 *      (which re-writes the doc WITH an owner). Silence is the right failure — the alternative is
 *      guessing an identity from an unowned record.
 *   3. Zero matches logs and returns. A notification that cannot be delivered privately is not
 *      delivered at all.
 *
 * Dead-subscription cleanup matches fanOutPush exactly (410/404 delete, 401 log-only — see
 * shouldDeleteSubscription).
 *
 * @param {object} payload            JSON-stringified for the push body — title, body, url, tag
 * @param {string[]} ownerUids        Firebase Auth uids allowed to receive this
 * @param {string} logTag             Short string for console log lines
 * @returns {Promise<number>}         How many subscriptions ACCEPTED the push. Zero is the reliable
 *                                    direction: it means nobody was reached, and a caller may act on
 *                                    that. A non-zero count means the push service took the message,
 *                                    not that a phone displayed it.
 */
async function sendTargetedPush(payload, ownerUids, logTag) {
    const uids = Array.from(new Set((ownerUids || []).filter(u => typeof u === 'string' && u)));
    if (uids.length === 0) {
        console.warn(`${logTag} No target uids — sending nothing (never fans out)`);
        return 0;
    }

    // One equality query per uid rather than a single `in` query: the target list is the admin roster
    // (one or two names), `in` caps at 30 values, and per-uid queries keep the failure of one lookup
    // from taking the others down with it.
    const results = await Promise.all(uids.map(uid =>
        getFirestore().collection('pushSubscriptions').where('owner', '==', uid).get()));
    const docs = results.flatMap(snap => snap.docs);
    if (docs.length === 0) {
        // Worth a warning, not a silent return: on a fresh project this means the admin has never
        // subscribed, but it ALSO means their subscription predates the owner stamp (see #2 above) —
        // and both look identical from here. Either way the queue still shows on the card.
        console.warn(`${logTag} No owner-stamped subscriptions for ${uids.length} target(s) — nothing sent`);
        return 0;
    }

    const payloadStr = JSON.stringify(payload);
    // ACCEPTED, not attempted (v21.85, external review). A caller that records "the admin has been
    // told" needs to know a push actually left, and `docs.length` says only that we tried: a
    // transient 500 from the push service, or an endpoint whose keys have rotated, counted exactly
    // the same as a delivered notice. It is still not a READ receipt — the push service accepting a
    // message is not the phone showing it — so 0 is the trustworthy half of this number: it means
    // nobody was reached, and a caller may rely on that direction.
    let accepted = 0;
    await Promise.allSettled(docs.map(async docSnap => {
        const { endpoint, keys } = docSnap.data();
        try {
            await getWebPush().sendNotification({ endpoint, keys }, payloadStr);
            accepted += 1;
        } catch (err) {
            if (shouldDeleteSubscription(err.statusCode)) {
                await docSnap.ref.delete();
                console.log(`${logTag} Removed dead subscription ${docSnap.id}`);
            } else {
                console.warn(`${logTag} Failed for ${docSnap.id}: HTTP ${err.statusCode} — ${err.message}`);
            }
        }
    }));
    console.log(`${logTag} Targeted send complete — ${accepted} of ${docs.length} subscription(s) accepted`);
    return accepted;
}

async function fanOutPush(payload, logTag) {
    const snapshot = await getFirestore().collection('pushSubscriptions').get();
    if (snapshot.empty) {
        console.log(`${logTag} No subscriptions — skipping`);
        return;
    }

    const payloadStr = JSON.stringify(payload);
    const sends = snapshot.docs.map(async docSnap => {
        const { endpoint, keys } = docSnap.data();
        try {
            await getWebPush().sendNotification({ endpoint, keys }, payloadStr);
        } catch (err) {
            // Delete ONLY genuinely-dead subscriptions (410/404). A 401 is a VAPID-auth
            // misconfig, not a dead endpoint — deleting on it would wipe the whole collection.
            // Full rationale + tests: shouldDeleteSubscription in roster-parse-helpers.js (v16.15/v16.81).
            if (shouldDeleteSubscription(err.statusCode)) {
                await docSnap.ref.delete();
                console.log(`${logTag} Removed dead subscription ${docSnap.id}`);
            } else {
                console.warn(`${logTag} Failed for ${docSnap.id}: HTTP ${err.statusCode} — ${err.message}`);
            }
        }
    });

    await Promise.allSettled(sends);
    console.log(`${logTag} Fan-out complete — attempted ${snapshot.size} subscription(s)`);
}


module.exports = { getWebPush, setupWebPush, sendTargetedPush, fanOutPush };
