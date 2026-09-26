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
 * Every attempt is CHARGED before its PIN is compared, and a correct PIN is REFUNDED afterwards
 * (Sep 2026 review — `reserveAttempt`/`refundAttempt`). Only failures remain counted, so ordinary use
 * never approaches the limit, and a refund that brings a bucket to zero deletes it, so the throttle
 * state still cannot be used to count how many people used the app. Charging first costs a correct
 * unlock one transaction; recording only failures after the compare let concurrent guesses all be
 * compared before any of them was counted. The trade is CONTENTION: every unlock, right or wrong,
 * writes the one all-sources document twice (charge, then refund), and writes to one document
 * serialise — nothing at a handful of unlocks a day, and the thing to revisit if that ever grows. Expired
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
 *     A correct PIN never stays counted, so ordinary use can never approach the limit however busy the
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
 * **`expected` is TRIMMED; `supplied` is not.** The stored secret is typed or piped in by a human
 * at deploy time, and the ordinary ways of doing that add a trailing newline —
 * `echo 1234 | gcloud secrets versions add` does, and a console text box can pick up a stray space
 * on a paste. The failure that causes is the worst kind available here: every unlock is refused
 * with a flat "PIN not recognised", which reads as a wrong code rather than a bad deploy, and the
 * one thing that would diagnose it — logging what was actually stored — is precisely what this
 * module must never do. Trimming cannot admit a wrong PIN; it can only let the intended one work.
 * `supplied` is deliberately left alone: it arrives from the client, `isValidPinShape` already
 * requires exactly four digits, and trimming it would quietly widen what the endpoint accepts.
 *
 * @param {unknown} supplied
 * @param {unknown} expected
 * @returns {boolean}
 */
function pinMatches(supplied, expected) {
    if (typeof supplied !== 'string' || typeof expected !== 'string') return false;
    expected = expected.trim();
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
 * Read the caller's address from the request — from the END of the forwarding chain.
 *
 * ── THIS TOOK THE FIRST ENTRY UNTIL v20.35, AND THAT WAS A REAL BYPASS ──────────────────────────
 *
 * `x-forwarded-for` is a comma-separated chain. The old code took the FIRST entry, on the reasoning
 * that the first entry is the client — with a comment conceding it was spoofable and arguing the
 * throttle was "a speed bump rather than the security boundary". That argument is wrong here, and
 * an external review was right to call it: against a FOUR-DIGIT secret the throttle **is** the
 * security boundary. Nothing else bounds 10,000 guesses, because the PIN cannot be made stronger
 * without making it unusable on a shared office PC.
 *
 * The bypass is trivial. Google's load balancer RETAINS any `X-Forwarded-For` the caller supplied
 * and appends the address it observed, and its own documentation warns the preceding values are not
 * verified. So a caller sending `X-Forwarded-For: 1.1.1.1`, then `1.1.1.2`, and so on, minted a
 * fresh throttle bucket per request and had no effective limit at all.
 *
 * **The direction of the chain is the fix.** A caller can only PREPEND — whatever they send ends up
 * at the front, and the platform's own observation is appended after it. Everything the caller
 * controls is therefore at the START, and the LAST entry is always platform-derived. So the last
 * entry is the only one worth keying on.
 *
 * **What the last entry actually is depends on the deployment chain, and coarse is the safe way to
 * be wrong.** It is the observed client address on a direct Cloud Run/Functions URL, and may be a
 * load-balancer address behind a GCLB — in which case every caller lands in ONE bucket. That is
 * acceptable *here specifically*, because the whole station already shares one corporate NAT
 * address, so `DEFAULT_THROTTLE` was sized for the everyone-in-one-bucket case from the start (see
 * the constant). Being coarser than intended over-throttles; being finer than intended, which is
 * what taking the first entry did, does not throttle at all.
 *
 * **And the throttle no longer rests on getting this right.** `GLOBAL_SOURCE_KEY` below counts
 * failures across every source under a fixed key that no header can influence, so even a chain
 * shape this function reads wrongly cannot produce an unbounded guess rate. Verify the real chain
 * against the deployed function before relying on the per-source granularity for anything.
 *
 * @param {{ headers?: Record<string, any>, ip?: string, socket?: { remoteAddress?: string } }} req
 * @returns {string|null}
 */
function clientIpOf(req) {
    const h = (req && req.headers) || {};
    const fwd = h['x-forwarded-for'];
    // Node lower-cases header names; a repeated header arrives as an array, in arrival order, so the
    // platform's own value is in the LAST element — take the last entry of the last element.
    const chain = Array.isArray(fwd) ? fwd[fwd.length - 1] : fwd;
    if (typeof chain === 'string' && chain.trim()) {
        const parts = chain.split(',').map(s => s.trim()).filter(Boolean);
        if (parts.length) return parts[parts.length - 1];
    }
    // No usable header: `req.ip` and the socket address are observed by the platform, not supplied
    // by the caller, so both are trustworthy.
    if (req && typeof req.ip === 'string' && req.ip.trim()) return req.ip.trim();
    const remote = req && req.socket && req.socket.remoteAddress;
    return typeof remote === 'string' && remote.trim() ? remote.trim() : null;
}

/**
 * The fixed key for the ALL-SOURCES failure counter (v20.35).
 *
 * Deliberately a constant, not derived from the request: that is the entire point. Every per-source
 * control on an internet-facing endpoint depends on attributing the request correctly, and that
 * attribution rests on a header chain whose exact shape depends on the deployment. This counter
 * depends on nothing the caller can influence, so it holds even if `clientIpOf` reads the chain
 * wrongly, if the chain shape changes under us, or if an attacker has genuinely distinct addresses
 * to rotate through — none of which the per-source throttle survives on its own.
 *
 * It is a BACKSTOP and is sized to stay out of the way: it must never be what stops ordinary use.
 * Not a valid Firestore document id by accident — it is written under the same collection as the
 * hashed per-source keys, and `sourceKeyFor` produces 32 hex chars, so a name that cannot collide
 * with one is used instead of a hash of some sentinel string.
 */
const GLOBAL_SOURCE_KEY = '_all-sources';

/**
 * The all-sources ceiling, and the arithmetic behind it.
 *
 * **200 failures per 15 minutes, then a 15-minute block.**
 *
 *   · **Against automation.** 200 per 15 minutes caps the whole endpoint at 800 guesses an hour, so
 *     walking all 10,000 combinations takes upwards of twelve hours of sustained traffic against a
 *     function whose normal volume is a handful of calls a day — and it holds no matter how many
 *     source identities the caller can manufacture. Before this, a caller who forged the header had
 *     no bound at all and could finish in minutes.
 *   · **For Marylebone.** Only FAILURES stay counted — a correct PIN is charged, then refunded, and a
 *     refund to zero deletes the row. 200 wrong entries
 *     inside fifteen minutes, across the entire station, is roughly four each from fifty people —
 *     which does not mean fumbling, it means the code in circulation is wrong. Stopping is then the
 *     correct behaviour, and the block clears itself in fifteen minutes.
 *
 * Set ABOVE `DEFAULT_THROTTLE.maxFailures` on purpose: if the chain collapses every caller into one
 * bucket, the per-source limit binds first and this never fires; if the chain is per-client, this is
 * the only thing bounding the total. Both shapes are covered without needing to know which one is
 * live.
 *
 * Like the per-source block, it EXPIRES on its own — a control that could be driven into a
 * permanent state by any passer-by is a denial-of-service handle pointed at the staff it protects.
 */
const GLOBAL_THROTTLE = Object.freeze({
    maxFailures:  200,
    windowMs:     15 * 60 * 1000,
    blockMs:      15 * 60 * 1000,
});

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
 * Check both buckets and, if neither is blocked, CHARGE the attempt to both — the decision and the
 * charge the handler runs inside ONE transaction, BEFORE the comparison (Sep 2026 review).
 *
 * Until then the check was a plain read before the compare and the charge a transaction after it,
 * so N requests arriving together all read "not blocked", all had their guess compared, and were
 * all charged afterwards: the limit bounded the RATE of charging, not the number of guesses
 * compared. Charging first, inside the transaction that checks, makes the Nth concurrent request
 * see the (N-1) charges before it and be refused. A correct PIN is refunded afterwards
 * (`refundAttempt`), so what a correct PIN costs in the end is still nothing.
 *
 * PURE. The caller owns the transaction.
 *
 * @param {object|null|undefined} sourceState  the per-source bucket as stored
 * @param {object|null|undefined} globalState  the all-sources bucket as stored
 * @param {number} now  epoch ms
 * @returns {{ blocked: { allowed: boolean, retryAfterSec: number }|null, source: object|null, global: object|null }}
 */
function reserveAttempt(sourceState, globalState, now) {
    // EITHER bucket being blocked blocks the attempt: the ceiling is a ceiling, not an average.
    const blocked = [throttleDecision(sourceState, now), throttleDecision(globalState, now)].find(d => !d.allowed);
    if (blocked) return { blocked, source: null, global: null };
    return {
        blocked: null,
        source: recordFailure(sourceState, now),
        // The global bucket carries its OWN, higher limit — that is what makes it a backstop.
        global: recordFailure(globalState, now, GLOBAL_THROTTLE),
    };
}

/**
 * Take back ONE charge `reserveAttempt` made, because the PIN it was charged for was right.
 *
 * PURE. Returns what to do with the stored bucket: `undefined` leave it alone, `null` delete it, or
 * the document to write. A bucket whose window has moved on since the charge (`windowStart` no
 * longer the one reserved) is left alone: the charge is no longer in it. A bucket brought back to
 * zero is DELETED rather than kept at zero, so a correct unlock leaves no row that dates it — the
 * collection still cannot be read as a record of who used the app. A block survives only if the
 * failures that remain would have tripped it on their own.
 *
 * @param {{ failures?: number, windowStart?: number, blockedUntil?: number }|null|undefined} state
 * @param {{ windowStart?: number }|null|undefined} reserved  what `reserveAttempt` wrote
 * @param {{ maxFailures?: number }} [cfg]
 * @returns {{ failures: number, windowStart: number, blockedUntil: number }|null|undefined}
 */
function refundAttempt(state, reserved, cfg) {
    const c = Object.assign({}, DEFAULT_THROTTLE, cfg || {});
    const s = state && typeof state === 'object' ? state : null;
    if (!s || !reserved || !Number.isFinite(s.windowStart) || s.windowStart !== reserved.windowStart) return undefined;
    const failures = Math.max(0, (Number.isFinite(s.failures) ? Math.floor(Number(s.failures)) : 0) - 1);
    if (failures === 0) return null;
    const blockedUntil = failures >= c.maxFailures && Number.isFinite(s.blockedUntil) ? Number(s.blockedUntil) : 0;
    return { failures, windowStart: Number(s.windowStart), blockedUntil };
}

/**
 * Has somebody changed the shared viewer account into something other than a bare capability?
 * Returns the reason, or `null` when it is as the unlock made it (Sep 2026 review).
 *
 * Every PIN holder holds a session on this ONE account, and a session can LINK a credential to its
 * own account — an email and password, a phone, a federated provider. Each is a way back in that
 * does not go through the PIN, so it survives a PIN rotation; an email under `@myb-roster.local`
 * would also put the account in front of Set up accounts and the leaver sweep, which could adopt it
 * as a member or disable it (a station-wide PIN outage). A disabled account is included because a
 * sweep is the likeliest way it got that way, and the PIN rotation, not a disable, is the kill switch
 * this feature documents. The unlock rebuilds a tampered account from nothing.
 *
 * @param {{ email?: string|null, phoneNumber?: string|null, providerData?: any[], disabled?: boolean }|null|undefined} record
 * @returns {string|null}
 */
function viewerAccountTamper(record) {
    if (!record || typeof record !== 'object') return null;
    if (record.disabled === true) return 'disabled';
    if (record.email) return 'has an email';
    if (record.phoneNumber) return 'has a phone number';
    if (Array.isArray(record.providerData) && record.providerData.length) return 'has a linked sign-in method';
    return null;
}

/**
 * Is this Auth account the shared viewer — by uid, or by carrying the viewer claim? Set up accounts
 * and the leaver sweep must never adopt, stamp or disable it, whatever email somebody linked to it.
 * @param {{ uid?: string, customClaims?: Record<string, any>|null }|null|undefined} record
 * @returns {boolean}
 */
function isViewerAccount(record) {
    if (!record || typeof record !== 'object') return false;
    return record.uid === CALENDAR_VIEWER_UID || !!(record.customClaims && record.customClaims.calendarViewer === true);
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
    GLOBAL_SOURCE_KEY,
    GLOBAL_THROTTLE,
    isValidPinShape,
    pinMatches,
    sourceKeyFor,
    clientIpOf,
    throttleDecision,
    recordFailure,
    reserveAttempt,
    refundAttempt,
    isThrottleStateStale,
    viewerClaims,
    viewerAccountTamper,
    isViewerAccount,
};
