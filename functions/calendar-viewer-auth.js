/**
 * calendar-viewer-auth.js — the PURE server-side rules behind the staff Calendar PIN.
 *
 * CommonJS, like every file under functions/. Split out of index.js for the same reason
 * roster-parse-helpers.js was: the decisions here are the security-relevant part, and they are only
 * testable if they are not tangled with `req`/`res`. Tested by calendar-viewer-auth.test.mjs.
 *
 * ── WHAT THIS FILE MUST NEVER DO ────────────────────────────────────────────────────────────────
 *
 * **It never learns, stores, logs or returns the PIN.** `pinMatches` takes both values and returns a
 * boolean; nothing else here sees one. There is deliberately no "which digit was wrong", no attempt
 * echo, and no error object carrying the input — an unauthenticated endpoint that reflects its own
 * input into a log is how a secret ends up in a log aggregator that a wider group can read than the
 * secret store it came from.
 *
 * ── THE THROTTLE IS THE ONLY THING STANDING BETWEEN 10,000 GUESSES AND THE ROSTER ───────────────
 *
 * A four-digit PIN has 10,000 combinations, so an unthrottled endpoint is not a barrier at all — a
 * script would walk the whole space in minutes. But the opposite failure is just as real and much
 * more likely to actually happen: **every PC at Marylebone shares one corporate NAT address**, so a
 * per-source limit tuned like a login (three strikes) would lock out the entire station the moment
 * two people fumbled. The numbers in `DEFAULT_THROTTLE` are chosen from that tension, not from a
 * template — see the constant.
 *
 * Only FAILURES are recorded. A correct PIN writes nothing, so the normal path costs no storage and
 * no latency, and the throttle state cannot be used to count how many people used the app. Expired
 * rows are swept opportunistically on the failure path — see `isThrottleStateStale`, which was
 * written here at v20.12 and NOT actually called until v20.15, so for three versions this comment
 * described a sweep that did not happen and the collection only ever grew.
 */

const crypto = require('crypto');

/** The dedicated viewer UID. Must match `CALENDAR_VIEWER_UID` in calendar-access-core.js — asserted
 *  by calendar-viewer-parity.test.mjs, which exists because the two live either side of the
 *  ESM/CommonJS boundary that this repo cannot bridge without a build step. */
const CALENDAR_VIEWER_UID = 'calendar-viewer';

/** Digits in the staff PIN. Shape only — the value is the CALENDAR_VIEWER_PIN secret. */
const PIN_LENGTH = 4;

/**
 * Throttle parameters.
 *
 * `maxFailures` is 30 per 15-minute window, then a 15-minute block. That is deliberately generous
 * for a login and deliberately tight for a brute force, and both directions were sized against the
 * real deployment:
 *
 *   · **Against automation.** A blocked source gets at most 30 guesses per 15 minutes — 2,880 a day
 *     — so walking all 10,000 from one address takes upwards of three days of sustained, obviously
 *     abnormal traffic against a function whose normal volume is a handful of calls a day.
 *   · **For Marylebone.** Thirty WRONG entries in fifteen minutes from the whole station is not
 *     fumbling, it is somebody who has the wrong code entirely — at which point stopping is correct.
 *     A correct PIN is never counted, so ordinary use can never approach the limit however busy the
 *     office is.
 *
 * The block EXPIRES on its own. There is no permanent or global lock, deliberately: a shared-source
 * control that can be driven into a permanent state by any passer-by is a denial-of-service handle
 * pointed at the staff it exists to protect.
 */
const DEFAULT_THROTTLE = Object.freeze({
    maxFailures:  30,
    windowMs:     15 * 60 * 1000,
    blockMs:      15 * 60 * 1000,
});

/**
 * Is this a plausible PIN candidate at all?
 *
 * Checked BEFORE any comparison so a malformed body is rejected without touching the secret, and so
 * the endpoint cannot be used as an oracle for the PIN's length (every wrong shape and every wrong
 * value return the same thing to the caller).
 *
 * @param {unknown} v
 * @returns {boolean}
 */
function isValidPinShape(v) {
    return typeof v === 'string' && v.length === PIN_LENGTH && /^[0-9]+$/.test(v);
}

/**
 * Constant-time PIN comparison.
 *
 * `timingSafeEqual` throws when the buffers differ in length, which would itself leak the length —
 * so both sides are hashed to a fixed 32 bytes first and the digests are compared. That also means
 * a misconfigured secret of the wrong length compares safely instead of throwing a 500 that would
 * distinguish "server misconfigured" from "wrong PIN".
 *
 * @param {unknown} supplied
 * @param {unknown} expected
 * @returns {boolean}
 */
function pinMatches(supplied, expected) {
    if (typeof supplied !== 'string' || typeof expected !== 'string') return false;
    if (!supplied.length || !expected.length) return false;
    const a = crypto.createHash('sha256').update(supplied, 'utf8').digest();
    const b = crypto.createHash('sha256').update(expected, 'utf8').digest();
    return crypto.timingSafeEqual(a, b);
}

/**
 * A privacy-conscious, stable key for a request source.
 *
 * The raw address is never stored: it is hashed and truncated, and the result is used as a Firestore
 * document id. **Be honest about what that does and does not buy.** An IPv4 address has far too
 * little entropy for a hash to be anonymising — anyone holding both the hash and a candidate address
 * can confirm the match. What it does buy is that the throttle collection cannot be read as a list
 * of addresses that visited the app, which is the realistic exposure for data that lives beside the
 * roster. It is a reduction, not anonymisation, and should not be described as the latter.
 *
 * Falls back to a single shared bucket when no address can be determined. That is the SAFE
 * direction: an unattributable caller is throttled together with every other unattributable caller
 * rather than being handed an unlimited allowance.
 *
 * @param {string|null|undefined} ip
 * @returns {string} a 32-char hex key, safe as a Firestore document id
 */
function sourceKeyFor(ip) {
    const raw = typeof ip === 'string' && ip.trim() ? ip.trim() : 'unknown-source';
    return crypto.createHash('sha256').update(raw, 'utf8').digest('hex').slice(0, 32);
}

/**
 * Read the caller's address from the request, preferring the proxy header Cloud Run sets.
 *
 * `x-forwarded-for` is a comma-separated chain and the CLIENT is the first entry. Taking the last
 * would read our own load balancer and put every caller on earth in one bucket; taking a middle
 * entry would trust something the client can spoof either way. The first entry is spoofable too —
 * which is exactly why the throttle is a speed bump rather than the security boundary, and why the
 * PIN itself is validated server-side regardless.
 *
 * @param {{ headers?: Record<string, any>, ip?: string, socket?: { remoteAddress?: string } }} req
 * @returns {string|null}
 */
function clientIpOf(req) {
    const h = (req && req.headers) || {};
    const fwd = h['x-forwarded-for'];
    if (typeof fwd === 'string' && fwd.trim()) {
        const first = fwd.split(',')[0].trim();
        if (first) return first;
    }
    if (Array.isArray(fwd) && fwd.length && typeof fwd[0] === 'string' && fwd[0].trim()) {
        return fwd[0].split(',')[0].trim();
    }
    if (req && typeof req.ip === 'string' && req.ip.trim()) return req.ip.trim();
    const remote = req && req.socket && req.socket.remoteAddress;
    return typeof remote === 'string' && remote.trim() ? remote.trim() : null;
}

/**
 * Decide whether a source may attempt right now, given its recorded failure state.
 *
 * PURE — takes the stored state and the clock, returns the decision plus the state to store. The
 * caller owns the transaction. Written this way because every interesting case here is a
 * BOUNDARY case (window just expired, block just expired, first ever attempt, corrupt stored
 * document) and none of them is reachable from a test that has to stand up a Firestore emulator.
 *
 * Takes no config: the only thing a block depends on is the `blockedUntil` stamp that
 * `recordFailure` already computed from the config at the time the block was imposed. Re-reading
 * the thresholds here would mean a config change silently re-judged blocks that are already
 * running, which is the kind of retroactive edit that makes a limit impossible to reason about.
 *
 * @param {{ failures?: number, windowStart?: number, blockedUntil?: number }|null|undefined} state
 * @param {number} now  epoch ms
 * @returns {{ allowed: boolean, retryAfterSec: number }}
 */
function throttleDecision(state, now) {
    const s = state && typeof state === 'object' ? state : null;
    const blockedUntil = s && Number.isFinite(s.blockedUntil) ? Number(s.blockedUntil) : 0;
    if (blockedUntil > now) {
        return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((blockedUntil - now) / 1000)) };
    }
    return { allowed: true, retryAfterSec: 0 };
}

/**
 * Fold one FAILED attempt into a source's stored state.
 *
 * PURE. Returns the document to write. A window that has expired restarts at one rather than
 * resuming — that is what makes the limit ROLLING rather than cumulative, and it is the property
 * that stops an office which mistypes a handful of times a week from eventually being blocked for
 * good by an ever-growing counter.
 *
 * @param {{ failures?: number, windowStart?: number, blockedUntil?: number }|null|undefined} state
 * @param {number} now  epoch ms
 * @param {{ maxFailures?: number, windowMs?: number, blockMs?: number }} [cfg]
 * @returns {{ failures: number, windowStart: number, blockedUntil: number }}
 */
function recordFailure(state, now, cfg) {
    const c = Object.assign({}, DEFAULT_THROTTLE, cfg || {});
    const s = state && typeof state === 'object' ? state : null;
    const prevStart = s && Number.isFinite(s.windowStart) ? Number(s.windowStart) : 0;
    const prevFails = s && Number.isFinite(s.failures) ? Math.max(0, Math.floor(Number(s.failures))) : 0;

    const windowLive = prevStart > 0 && (now - prevStart) < c.windowMs;
    const windowStart = windowLive ? prevStart : now;
    const failures = windowLive ? prevFails + 1 : 1;

    // `>=`, not `>`: the attempt that REACHES the limit is the one that trips it. With `>` the
    // source would get maxFailures + 1 guesses per window, which is the sort of off-by-one that a
    // test asserting "31 is blocked" would happily confirm as correct.
    const blockedUntil = failures >= c.maxFailures ? now + c.blockMs : 0;
    return { failures, windowStart, blockedUntil };
}

/**
 * Is a stored throttle document old enough to delete?
 *
 * The collection is swept opportunistically rather than by a scheduled job — there is no TTL policy
 * to depend on, and a handful of documents does not justify one. Exposed as a pure predicate so the
 * retention rule is stated once and tested, rather than being an inline date comparison nobody
 * looks at again.
 *
 * **Being tested is not the same as being CALLED**, which is how this shipped inert at v20.12: it
 * had unit tests covering every boundary and no caller anywhere, so the suite was green and the
 * collection grew for ever. The sweep now runs on the failure path in `unlockCalendarViewer`.
 *
 * @param {{ windowStart?: number, blockedUntil?: number }|null|undefined} state
 * @param {number} now  epoch ms
 * @param {{ windowMs?: number, blockMs?: number }} [cfg]
 * @returns {boolean}
 */
function isThrottleStateStale(state, now, cfg) {
    const c = Object.assign({}, DEFAULT_THROTTLE, cfg || {});
    const s = state && typeof state === 'object' ? state : null;
    if (!s) return true;
    const start = Number.isFinite(s.windowStart) ? Number(s.windowStart) : 0;
    const until = Number.isFinite(s.blockedUntil) ? Number(s.blockedUntil) : 0;
    if (until > now) return false;                       // still serving a block
    return (now - Math.max(start, until)) > (c.windowMs + c.blockMs);
}

/**
 * The complete claim set the viewer account carries.
 *
 * A function rather than a constant so a caller cannot mutate the shared object, and returning a
 * FRESH object every time so `setCustomUserClaims` (which REPLACES every claim) can be handed this
 * directly. That replacement is the safety property: if this account ever acquired a stray claim by
 * any route, the next successful unlock strips it.
 *
 * The list is exactly one entry, and that is the whole design — no `name`, no `admin`, no `manager`,
 * no `linksDesigner`. `calendar-viewer-auth.test.mjs` asserts the ABSENCE of each of those by name,
 * so adding one is a test failure rather than a code review someone has to catch.
 *
 * @returns {{ calendarViewer: true }}
 */
function viewerClaims() {
    return { calendarViewer: true };
}

module.exports = {
    CALENDAR_VIEWER_UID,
    PIN_LENGTH,
    DEFAULT_THROTTLE,
    isValidPinShape,
    pinMatches,
    sourceKeyFor,
    clientIpOf,
    throttleDecision,
    recordFailure,
    isThrottleStateStale,
    viewerClaims,
};
