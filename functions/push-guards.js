'use strict';

/**
 * functions/push-guards.js — the two TRANSPORT guards every Web Push send passes through: may the
 * server send to this stored endpoint at all (`isAllowedPushEndpoint`, against `PUSH_SERVICE_HOSTS`),
 * and does a failed send mean the subscription is dead (`shouldDeleteSubscription`). Both senders in
 * push.js ask them; `.claude/rules/notifications.md` → "Only to a push service" and "VAPID fingerprint
 * migration" are the contract.
 *
 * Pure: no Firebase, no web-push, requires nothing — tested in roster-parse-helpers.test.mjs and, through
 * the real senders, push-transport.test.mjs. MOVED HERE WHOLE from roster-parse-helpers.js (25 Nov 2026),
 * which had reached its line cap holding three jobs that were not the roster parse.
 */

/**
 * Decide whether a failed Web Push send means the subscription is DEAD and should be deleted.
 * Extracted + tested (v16.81) because this encodes the load-bearing v16.15 lesson that previously
 * survived only as a comment inline in fanOutPush: a 410/404 is a genuinely gone endpoint (delete
 * it), but a 401 is the push service rejecting our VAPID auth JWT — a server MISCONFIG in which
 * EVERY send 401s. Deleting on 401 would wipe the whole pushSubscriptions collection in one run,
 * and since the client VAPID fingerprint (derived from the unchanged public key) wouldn't change,
 * no device would ever re-subscribe → a permanent, silent notification outage. So ONLY 410/404
 * delete; everything else (401, 5xx, network) is a transient/keep.
 * @param {unknown} statusCode  HTTP status from the push service, as the send's error carried it (compared, never read)
 * @returns {boolean} true → delete the subscription doc; false → keep and log
 */
function shouldDeleteSubscription(statusCode) {
    return statusCode === 410 || statusCode === 404;
}

/**
 * The push services a browser actually hands out endpoints on (v24.48, external audit F4).
 * Google's covers Chrome, Edge on Android and Samsung Internet; Apple's covers Safari and iOS
 * installs; Microsoft's is desktop Edge; Mozilla's is Firefox. Matched as the WHOLE host or a
 * dot-bounded suffix, so `fcm.googleapis.com.evil.example` and `evilfcm.googleapis.com` both fail.
 */
const PUSH_SERVICE_HOSTS = Object.freeze([
    'fcm.googleapis.com', 'android.googleapis.com',
    'push.services.mozilla.com',
    'push.apple.com',
    'notify.windows.com',
]);

/**
 * May the server send to this stored endpoint? (v24.48, external audit F4.)
 *
 * The endpoint is written by a BROWSER into `pushSubscriptions`, and the rules can check only its
 * type and length — so a signed-in account could store any URL, and every later fan-out would make
 * the Cloud Function POST to it: an outbound request to a destination of somebody else's choosing
 * (SSRF), on the server's network, as often as a Huddle arrives. The guard belongs here, at the SEND,
 * because that is where the request is made and because it also covers records stored before it.
 *
 * HTTPS on the default port, no credentials in the URL, and a host that is one of the push services
 * above. A refused endpoint is SKIPPED, never deleted: an unknown host may be a provider this list
 * has not met yet, and losing a real subscription silently is worse than logging it.
 * @param {unknown} endpoint
 * @returns {boolean}
 */
function isAllowedPushEndpoint(endpoint) {
    if (typeof endpoint !== 'string' || endpoint.length > 2048) return false;
    let u;
    try { u = new URL(endpoint); } catch { return false; }
    if (u.protocol !== 'https:' || u.username || u.password) return false;
    if (u.port && u.port !== '443') return false;
    const host = u.hostname.toLowerCase();
    return PUSH_SERVICE_HOSTS.some(h => host === h || host.endsWith('.' + h));
}

module.exports = {
    shouldDeleteSubscription,
    isAllowedPushEndpoint,
    PUSH_SERVICE_HOSTS,
};
