'use strict';

/**
 * functions/reset-request.js — `requestPasswordReset`, the doorbell a locked-out member rings for the
 * admin, and the one push that rings it.
 *
 * MOVED OUT OF auth-endpoints.js WHOLE (Nov 2026), when that file reached its size cap with the
 * sign-in audit's account fixes still to land there. It was the one self-contained part: its own
 * constants, its own throttle, its own notification, and nothing shared with the account handlers but
 * the roster and the push transport. Nothing about it changed in the move. auth-endpoints.js still
 * BUILDS it and returns it beside the other four, so index.js and the deploy surface are untouched.
 *
 * ONE THING STAYED BEHIND, ON PURPOSE: the kill switch, `RESET_REQUESTS_ENABLED`. It is where the
 * break-glass instructions say it is (PASSWORD_DESIGN.md), and it is handed in here as `enabled`. An
 * incident switch is the last thing to move without moving its instructions in the same breath. Only
 * `true` opens the door, so a builder that forgets to pass it closes it — the visible failure.
 *
 * The pure decisions it asks — the throttle, the coalescing window, the notice's words — are in
 * roster-parse-helpers.js and unit-tested there; auth-endpoints.test.mjs drives this handler for real.
 */

const { onRequest } = require('firebase-functions/v2/https');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const {
    nameToEmail,
    buildPushPayload,
    resolveRosterAuthConfig,
    shouldRecordResetRequest,
    buildResetRequestNotice,
    shouldNotifyAdmin,
} = require('./roster-parse-helpers');
const { setupWebPush, sendTargetedPush } = require('./push');
const { readJsonBody } = require('./request-helpers');
const rosterMembers = require('./roster-members.json');

/**
 * Build the reset-request endpoint. Called once, by buildAuthEndpoints (auth-endpoints.js).
 * @param {object} deps
 * @param {import('firebase-functions/params').SecretParam} deps.VAPID_PRIVATE_KEY
 * @param {string}   deps.VAPID_PUBLIC_KEY
 * @param {string}   deps.STAFF_SITE_URL
 * @param {string[]} deps.ADMIN_FUNCTION_ORIGINS
 * @param {boolean}  deps.enabled  the kill switch (`RESET_REQUESTS_ENABLED`, auth-endpoints.js); only `true` opens
 * @param {number}   [deps.resetRequestAnswerFloorMs]  the test seam for RESET_REQUEST_ANSWER_FLOOR_MS;
 *                                                   index.js passes nothing, so production keeps it
 */
function buildResetRequestEndpoint({ VAPID_PRIVATE_KEY, VAPID_PUBLIC_KEY, STAFF_SITE_URL, ADMIN_FUNCTION_ORIGINS,
    enabled, resetRequestAnswerFloorMs }) {

/**
 * requestPasswordReset — a locked-out member asks the admin to reset their password.
 *
 * ONE OF THE APP'S TWO PUBLIC UNAUTHENTICATED ENDPOINTS (the other is `unlockCalendarViewer`, the
 * staff-PIN exchange), and deliberately so. A member who has forgotten their password cannot sign
 * in, so they have no Firebase identity — and nothing in the app signs in anonymously (the Calendar
 * stopped at v20.12, and the last path that could was retired at v24.34). So a direct Firestore
 * write is impossible for exactly the person who needs this. The alternatives were to establish a new
 * anonymous session on the protected pages (an explicit anti-goal in SECURITY_RELEASE_PLAN.md, and new
 * auth behaviour beside the login path — the area with this app's worst outage history) or to open a
 * client-writable collection. A server endpoint beats both: Firestore rules stay fully CLOSED to
 * clients (`allow write: if false` on resetRequests — only this function's Admin SDK writes), and every
 * validation is server-side and unbypassable.
 *
 * It records a request and NOTHING ELSE. It never resets a password: an unauthenticated caller who
 * could force any member back to the guessable surname default would undo exactly what v18.92 shipped,
 * and with token revocation would also boot them off their devices. The admin performs the reset from
 * Operations → Account status. The human in the loop IS the authentication — this is a doorbell, not a
 * recovery mechanism.
 *
 * How the abuse surface is bounded:
 *  · **The doc ID is the member name**, so the collection can never exceed the roster. Flooding is
 *    impossible BY CONSTRUCTION, not by rate limiting — the worst case is one stale row per member.
 *  · **The name must be on the server-owned roster** (`processMembers`: roster-members.json, B4). That also
 *    makes the name safe for the admin card to render: it came from OUR list, never the request body.
 *  · **No free text of any kind is stored.** An unauthenticated endpoint writing caller-controlled
 *    strings into an admin UI is an injection surface for no benefit.
 *  · **Throttled** per member (shouldRecordResetRequest) so repeat taps don't inflate the count.
 *  · **maxInstances** caps the cost of a flood. (The eventual real control is App Check — Track D.)
 *  · **No enumeration**: it answers the same way for any roster name whether or not an account exists,
 *    and the roster names are already public in the login dropdown, so nothing new is revealed.
 *  · **No "who is locked out" oracle**: a recorded request and a throttled repeat get the same body,
 *    and neither is answered before RESET_REQUEST_ANSWER_FLOOR_MS, so their timing matches too.
 *
 * Body: { member: string }. Always 200 for a valid roster name.
 */
const RESET_REQUEST_THROTTLE_MS = 10 * 60 * 1000;   // 10 minutes
// No answer to a valid name before this long after the request began (functions-core-4). A throttled
// repeat answered after two round trips and a recorded request after four to six plus a push, so the
// TIMING named who was locked out right now — what the identical body exists to hide. Sized above the
// recorded path's ordinary time AND one backoff of its two-attempt claim (3 s, review 11 Nov 2026: at
// 2 s a burst's retry showed). A push slow enough to pass it, or a large deliberate burst queued on
// the rows' locks, still shows — the price of not making a locked-out member wait longer (their screen
// reads "Sending…"), and every name such a burst probes is recorded where the admin sees it.
const RESET_REQUEST_ANSWER_FLOOR_MS = 3_000;
const answerFloorMs = Number.isFinite(resetRequestAnswerFloorMs) ? resetRequestAnswerFloorMs : RESET_REQUEST_ANSWER_FLOOR_MS;
// How long the admin notification may take before the endpoint gives up on it and answers the member
// anyway. Well inside the function's 30s timeout, leaving room for the record itself — the request is
// the product, the push is a courtesy, and the courtesy must never cost the product.
const ADMIN_NOTIFY_BUDGET_MS = 10_000;
// Each admin push's own bound, well inside that budget (functions-core-6): after the lookups, the
// transport's default 10 s meant a stalled push service always outlasted it.
const ADMIN_NOTIFY_SEND_TIMEOUT_MS = 5_000;
// One admin push per this window, however many DIFFERENT members file a request inside it. The
// per-member throttle above cannot bound a walk of the public roster; this can. Chosen to be long
// enough to absorb a scripted burst and short enough that a genuine second request later in a shift
// still rings. See shouldNotifyAdmin.
const ADMIN_NOTIFY_COALESCE_MS = 5 * 60 * 1000;   // 5 minutes
// How long one request's claim to be the sender holds the others back: the whole notify budget and a
// margin. A claim whose sender died is ignored after this, so a crash costs one window, not the queue.
const ADMIN_NOTIFY_CLAIM_MS = ADMIN_NOTIFY_BUDGET_MS + 5_000;

/**
 * Push the "someone asked for a password reset" notice to the ADMIN's devices only (Phase 2).
 *
 * Two lookups, both of which fail closed rather than widening the audience:
 *  · admin name → Firebase Auth uid (`getUserByEmail` on the synthetic account address). A name that
 *    can't be resolved is simply dropped from the target list — an unresolvable admin must not become
 *    "send to everyone".
 *  · uid → their own push subscriptions (sendTargetedPush).
 *
 * The headline states the queue DEPTH, so read `resetRequests` AFTER the write — inside the claim's
 * transaction, which is also what makes one push per burst hold (see the comment there). The
 * collection is bounded by the roster (doc id = member name), so this is a ~50-doc metadata read.
 *
 * @param {string} member                  who asked (from the server-owned roster)
 * @param {string[]} adminNames            roster-members.json roles.admin
 * @param {import('firebase-functions/params').SecretParam} vapidPrivate
 * @returns {Promise<void>}
 */
async function notifyAdminOfResetRequest(member, adminNames, vapidPrivate) {
    const uids = [];
    for (const name of adminNames || []) {
        try {
            const user = await getAuth().getUserByEmail(nameToEmail(name));
            if (user && user.uid) uids.push(user.uid);
        } catch (e) {
            console.warn('[requestPasswordReset] could not resolve admin uid for', name, e && e.code);
        }
    }
    if (uids.length === 0) return;   // sendTargetedPush would refuse anyway; skip the VAPID setup

    // ONE PUSH PER BURST, DECIDED BY A CLAIM TAKEN IN A TRANSACTION (sign-in review, Nov 2026). The
    // per-member throttle cannot bound a caller walking the public roster (v18.97), and read → send →
    // stamp let every request in a parallel burst read the rows before any push was stamped: fifty
    // names, fifty pushes. Now one transaction reads every row and marks THIS one as the sender unless
    // a push was ACCEPTED inside the window (`notifiedAt` — v21.85: a failed push must not silence the
    // next member) or another request is sending now (`notifyClaimedAt`). Transactions over the same
    // rows commit one at a time, so one request in a burst wins and the rest find its claim.
    //  · TWO attempts, not the SDK's five (review, 11 Nov 2026): each retry backs off 0.5–3.4 s, so a
    //    burst held recorded requests past the answer floor throttled ones met (RESET_REQUEST_ANSWER_FLOOR_MS).
    //  · A push that reached nobody is tried ONCE more, with the queue as it then stands: the requests
    //    that found its claim stood aside for it, and would otherwise wait for the next request.
    const rows = getFirestore().collection('resetRequests');
    const ms = (t) => (t && typeof t.toMillis === 'function' ? t.toMillis() : NaN);
    for (let round = 0; round < 2; round++) {
        let pending = 1;
        try {
            const claimed = await getFirestore().runTransaction(async (tx) => {
                const snap = await tx.get(rows.select('notifiedAt', 'notifyClaimedAt'));
                pending = snap.size || 1;
                const others = snap.docs.filter(d => d.id !== member).map(d => d.data());
                const now = Date.now();
                if (!shouldNotifyAdmin(others.map(o => ms(o.notifiedAt)), now, ADMIN_NOTIFY_COALESCE_MS)) return false;
                // Held while |Δ| < life: a claim stamped a moment AHEAD of this clock still holds (unlike a
                // future `notifiedAt`), and one far ahead — a clock far out — cannot hold the queue for ever.
                if (others.some(o => Math.abs(now - ms(o.notifyClaimedAt)) < ADMIN_NOTIFY_CLAIM_MS)) return false;
                tx.update(rows.doc(member), { notifyClaimedAt: FieldValue.serverTimestamp() });
                return true;
            }, { maxAttempts: 2 });
            if (!claimed) {
                console.log('[requestPasswordReset] notification coalesced — another push covers it; pending:', pending);
                return;
            }
        } catch (e) {
            // ABORTED (10): the burst held these rows past the last retry, and one of its requests claimed.
            // NOT_FOUND (5): the admin cleared this row first. Stand aside for both. Anything else is a read
            // that failed: notify with a count of 1, as before — a possibly-low count still does its job.
            if (e && (e.code === 10 || e.code === 5)) {
                console.log('[requestPasswordReset] notification left to the burst for', member, e.code);
                return;
            }
            console.warn('[requestPasswordReset] coalescing read failed — notifying with 1', e && e.code);
            pending = 1;
        }
        let accepted = 0;
        try {
            // Inside (review, 11 Nov 2026): a VAPID key that will not load must still release the claim.
            setupWebPush(vapidPrivate, VAPID_PUBLIC_KEY);
            const { headline, body } = buildResetRequestNotice(member, pending);
            accepted = await sendTargetedPush(
                buildPushPayload({
                    feature: 'resetRequest',
                    headline,
                    body,
                    url: `${STAFF_SITE_URL}/operations.html#reset-requests`,
                }),
                uids,
                '[reset-request]',
                { timeoutMs: ADMIN_NOTIFY_SEND_TIMEOUT_MS },
            );
        } catch (e) {
            console.warn('[requestPasswordReset] the admin push failed for', member, e && e.message);
        }
        // Release the claim however the send ended, and record that the admin was REACHED only when a
        // subscription accepted the push, so the next member in the window rings the phone instead of
        // inheriting a silence. Wrapped: a lost write costs a duplicate notification at worst.
        // update(), never a merge-set (functions-core-6): this can run after the member was answered
        // and the admin has cleared the row, and a merge brought it back as a request nobody made.
        try {
            await rows.doc(member).update(accepted > 0
                ? { notifiedAt: FieldValue.serverTimestamp(), notifyClaimedAt: FieldValue.delete() }
                : { notifyClaimedAt: FieldValue.delete() });
        } catch (e) {
            console.warn('[requestPasswordReset] could not record the push for', member, e && e.code);
        }
        if (accepted > 0) return;
        console.warn('[requestPasswordReset] nothing accepted the push for', member, '— not stamping notifiedAt');
    }
}

const requestPasswordReset = onRequest(
    {
        region: 'europe-west2', timeoutSeconds: 30, cors: ADMIN_FUNCTION_ORIGINS, maxInstances: 3,
        // Needed for the admin notification (Phase 2). Recording the request does not depend on it —
        // a missing/rotated key degrades to "the row is there, the phone stays quiet".
        secrets: [VAPID_PRIVATE_KEY],
    },
    async (req, res) => {
        // Measured from the top, so the floor covers every round trip either path makes.
        const answerNotBefore = Date.now() + answerFloorMs;
        if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
        // The kill switch, server-side (v18.97). 503 rather than 404: it is honest about the endpoint
        // existing but being closed, and it does not change what an outsider can learn about the
        // roster. The client link is hidden separately by CONFIG.PASSWORD_RESET_REQUESTS. The switch itself
        // is RESET_REQUESTS_ENABLED in auth-endpoints.js, handed in as `enabled` (this file's header).
        if (enabled !== true) return res.status(503).json({ error: 'Reset requests are temporarily unavailable' });

        const body = readJsonBody(req);   // a Buffer body used to answer 400 "Missing member" (functions-core-8)
        const member = typeof body.member === 'string' ? body.member.trim() : '';
        if (!member) return res.status(400).json({ error: 'Missing member' });

        const cfg = resolveRosterAuthConfig(rosterMembers);
        if (cfg.error) return res.status(500).json({ error: 'Server roster config invalid' });
        // Unknown name → 404 with a generic message. The roster IS public (login dropdown), so this
        // reveals nothing; it just stops junk names creating rows.
        if (!cfg.processMembers.includes(member)) {
            return res.status(404).json({ error: 'Unknown member' });
        }

        try {
            const docRef = getFirestore().collection('resetRequests').doc(member);

            // Whether a Firebase account exists, and is enabled (sign-in review, Nov 2026), decides the
            // remedy the admin needs: Reset, or Set up accounts. The login overlay must not distinguish
            // these (it would leak which names are provisioned); the admin's own card has no such
            // constraint, and guessing wrong costs a round trip.
            //
            // A FAILURE HERE MUST NOT LOSE THE REQUEST (fix, v18.94). This used to rethrow anything that
            // wasn't `user-not-found`, so a transient Auth blip returned 500 and wrote nothing — trading
            // the whole doorbell for a nicety, at the one moment recovery matters. `provisioned` is now
            // CLEARED when it can't be determined (with `disabled`: an older row's answer must not stand in,
            // review 11 Nov 2026), and the card treats unknown as "check yourself".
            /** @type {boolean|null} */
            let provisioned = true;
            let disabled = false;
            try {
                disabled = !!(await getAuth().getUserByEmail(nameToEmail(member)))?.disabled;
            } catch (e) {
                if (e && e.code === 'auth/user-not-found') provisioned = false;
                else {
                    provisioned = null;
                    console.warn('[requestPasswordReset] provisioned lookup failed for', member, e && e.code);
                }
            }

            // TRANSACTION, not read-then-write (fix, v18.94). The old sequential get→set let every
            // request already in flight read a stale timestamp and write: 40 concurrent taps recorded 40
            // and drove `count` to 40 inside the window the throttle exists to collapse to 1 — which
            // also means N writes/second to ONE document, past Firestore's ~1/s sustained guidance. The
            // count is what the admin reads as "how stuck is this person", so it has to mean something.
            const recorded = await getFirestore().runTransaction(async tx => {
                const snap   = await tx.get(docRef);
                const stamp  = snap.exists ? snap.data().requestedAt : null;
                const lastMs = stamp && typeof stamp.toMillis === 'function' ? stamp.toMillis() : null;
                if (!shouldRecordResetRequest(lastMs, Date.now(), RESET_REQUEST_THROTTLE_MS)) return false;
                /** @type {any} */
                const data = {
                    memberName:  member,
                    requestedAt: FieldValue.serverTimestamp(),
                    count:       FieldValue.increment(1),
                };
                Object.assign(data, provisioned === null
                    ? { provisioned: FieldValue.delete(), disabled: FieldValue.delete() } : { provisioned, disabled });
                tx.set(docRef, data, { merge: true });
                return true;
            });

            console.log('[requestPasswordReset]', recorded ? 'recorded' : 'throttled', 'for', member,
                        'provisioned:', provisioned);

            // Tell the admin (Phase 2) — ONLY on a genuinely-recorded request: a throttled repeat is the
            // same person asking twice, and the throttle is the rate limit for the notification too.
            // It can NEVER fail the request: the doorbell is the row; the push is a courtesy on top, and
            // a push outage turned into a 500 would send the member away thinking nobody heard (v18.94).
            // TIME-BOXED, and that is the load-bearing part: the try/catch survives only a REJECTION,
            // and none of the notify path's network calls is guaranteed to settle. Unbounded, a hung push
            // service ate the function's 30s and Cloud Run answered an error to a member whose request
            // WAS recorded — the never-settles-is-not-a-rejection class v18.94 fixed in the forced
            // overlay. The race stops the WAITING, not the work, so each send has its own bound and the
            // stamp it ends with cannot re-create a cleared row (ADMIN_NOTIFY_SEND_TIMEOUT_MS, functions-core-6).
            if (recorded) {
                /** @type {ReturnType<typeof setTimeout>|undefined} */ let notifyTimer;
                try {
                    await Promise.race([
                        notifyAdminOfResetRequest(member, cfg.admin, VAPID_PRIVATE_KEY),
                        new Promise((_, rej) => {
                            notifyTimer = setTimeout(() => rej(new Error('notify timed out')), ADMIN_NOTIFY_BUDGET_MS);
                        }),
                    ]);
                } catch (e) {
                    console.warn('[requestPasswordReset] admin notify failed for', member, e && e.message);
                } finally {
                    // The race is settled; the losing timer must not run on for its full 10s after the answer
                    // has gone (test audit, 7 Nov 2026 — it held this file's suite open ten seconds a run).
                    clearTimeout(notifyTimer);
                }
            }
            // IDENTICAL body either way (fix, v18.94). `throttled: true` was the exact oracle: anyone could
            // poll the 50 public names and learn who is locked out RIGHT NOW — a ready-made pretext for a
            // "hi, it's IT about your password reset" call. The distinction stays in the log line, where
            // only the admin sees it. AND NO SOONER than the floor, or the timing says it instead
            // (RESET_REQUEST_ANSWER_FLOOR_MS, functions-core-4).
            const holdMs = answerNotBefore - Date.now();
            if (holdMs > 0) await new Promise((resolve) => setTimeout(resolve, holdMs));
            return res.json({ ok: true });
        } catch (e) {
            console.error('[requestPasswordReset] failed for', member, e && e.code, e);
            return res.status(500).json({ error: 'Could not record the request' });
        }
    }
);

    return { requestPasswordReset };
}

module.exports = { buildResetRequestEndpoint };
