/**
 * calendar-viewer-auth.test.mjs — the server-side staff-PIN rules.
 * Run: node --test calendar-viewer-auth.test.mjs   (part of `npm run test:hygiene`)
 *
 * These decide whether ten thousand guesses are practical, so they are the part of this feature
 * most worth testing and the part least reachable from any other test. Every interesting case is a
 * BOUNDARY — the window that has just expired, the block that has just lifted, the attempt that
 * reaches the limit rather than passing it, the stored document that is corrupt — and none of them
 * is reachable from an emulator test without waiting fifteen real minutes.
 *
 * The other half is what must NOT happen: no PIN in a log, no PIN in an error, no length oracle,
 * and no claim on the viewer account beyond the one capability. Those are asserted by NAME here,
 * so adding `name` or `admin` to the viewer is a test failure rather than a review someone catches.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
    CALENDAR_VIEWER_UID, PIN_LENGTH, DEFAULT_THROTTLE,
    isValidPinShape, pinMatches, sourceKeyFor, clientIpOf,
    throttleDecision, recordFailure, isThrottleStateStale, viewerClaims,
} = require('./functions/calendar-viewer-auth.js');

const T = DEFAULT_THROTTLE;

describe('isValidPinShape — a gate, never an oracle', () => {
    test('accepts exactly PIN_LENGTH digits', () => {
        assert.equal(isValidPinShape('0000'), true);
        assert.equal(isValidPinShape('9137'), true);
    });

    test('rejects wrong lengths, non-digits, and non-strings', () => {
        for (const v of ['', '1', '123', '12345', '12a4', ' 123', '12 4', '+123', '1.23',
                         null, undefined, 1234, {}, []]) {
            assert.equal(isValidPinShape(/** @type {any} */ (v)), false, `accepted ${JSON.stringify(v)}`);
        }
    });

    test('runs BEFORE any comparison, so the endpoint cannot leak the length', () => {
        // The handler's `isValidPinShape(x) && pinMatches(...)` short-circuits, so a wrong-shape
        // candidate never touches the secret. This asserts the property the handler relies on:
        // shape alone decides, with no reference to any expected value.
        assert.equal(isValidPinShape.length, 1, 'isValidPinShape must take only the candidate');
    });
});

describe('pinMatches — constant time, and safe on every wrong input', () => {
    test('matches an identical value and nothing else', () => {
        assert.equal(pinMatches('4821', '4821'), true);
        assert.equal(pinMatches('4821', '4822'), false);
        assert.equal(pinMatches('4821', '1284'), false);
    });

    test('a STORED value with surrounding whitespace still matches — the deploy-day trap', () => {
        // `echo 4821 | gcloud secrets versions add` stores "4821\n", and a console paste can pick
        // up a space. Untrimmed, that refuses every unlock with a flat "PIN not recognised" — which
        // reads as a wrong code rather than a bad deploy, and cannot be diagnosed by logging,
        // because this module must never log a PIN. The one plausible operator error, and the one
        // with no visible cause.
        assert.equal(pinMatches('4821', '4821\n'), true);
        assert.equal(pinMatches('4821', '4821\r\n'), true);
        assert.equal(pinMatches('4821', ' 4821 '), true);
    });

    test('trimming the stored value cannot admit a WRONG PIN', () => {
        // The whole safety argument for the trim. It only ever lets the intended value through.
        assert.equal(pinMatches('4821', ' 4822 '), false);
        assert.equal(pinMatches('4821', '48 21'), false, 'inner whitespace must not be collapsed');
        assert.equal(pinMatches('4821', '   '), false, 'a whitespace-only secret is not a match');
    });

    test('the SUPPLIED value is NOT trimmed — that would widen what the endpoint accepts', () => {
        // Asymmetric on purpose: `supplied` is client input and `isValidPinShape` already requires
        // exactly four digits. Trimming here would make the pair disagree about what a PIN is.
        assert.equal(pinMatches('4821 ', '4821'), false);
        assert.equal(pinMatches(' 4821', '4821'), false);
    });

    test('DIFFERENT LENGTHS do not throw — that would itself be a length oracle', () => {
        // `timingSafeEqual` throws on unequal buffer lengths, which would turn a wrong-length guess
        // into a 500 while a wrong-value guess returned 401. Both sides are hashed to 32 bytes
        // first, so the comparison is always well-formed.
        assert.doesNotThrow(() => pinMatches('1', '123456'));
        assert.equal(pinMatches('1', '123456'), false);
        assert.equal(pinMatches('123456', '1'), false);
    });

    test('empty and non-string inputs are false, never a throw', () => {
        for (const [a, b] of [['', '1234'], ['1234', ''], [null, '1234'], ['1234', undefined],
                              [1234, '1234'], [{}, '1234']]) {
            assert.equal(pinMatches(/** @type {any} */ (a), /** @type {any} */ (b)), false);
        }
    });

    test('a MISCONFIGURED secret of the wrong length compares safely', () => {
        // If CALENDAR_VIEWER_PIN were set to something odd, this must return false rather than
        // throwing — a 500 here would distinguish "server misconfigured" from "wrong PIN".
        assert.equal(pinMatches('1234', 'not-a-pin-at-all'), false);
    });
});

describe('sourceKeyFor / clientIpOf', () => {
    test('the same address always gives the same key, and a different one does not', () => {
        assert.equal(sourceKeyFor('10.0.0.1'), sourceKeyFor('10.0.0.1'));
        assert.notEqual(sourceKeyFor('10.0.0.1'), sourceKeyFor('10.0.0.2'));
    });

    test('the RAW address never appears in the key', () => {
        const ip = '203.0.113.45';
        assert.equal(sourceKeyFor(ip).includes(ip), false);
        assert.equal(sourceKeyFor(ip).includes('203'), false);
    });

    test('the key is a legal Firestore document id', () => {
        // 32 hex chars: no slash, no dot, not `.`/`..`, well under 1500 bytes.
        const k = sourceKeyFor('192.168.1.1');
        assert.match(k, /^[0-9a-f]{32}$/);
    });

    test('an UNKNOWN source falls into ONE shared bucket, not an unlimited allowance', () => {
        // The safe direction. An unattributable caller is throttled together with every other
        // unattributable caller; giving each its own fresh state would be a free bypass.
        assert.equal(sourceKeyFor(null), sourceKeyFor(undefined));
        assert.equal(sourceKeyFor(null), sourceKeyFor(''));
        assert.equal(sourceKeyFor(null), sourceKeyFor('   '));
    });

    test('clientIpOf takes the FIRST x-forwarded-for entry — the client, not our proxy', () => {
        // The last entry is our own load balancer, which would put every caller on earth in one
        // bucket and make the throttle a global outage switch.
        assert.equal(clientIpOf({ headers: { 'x-forwarded-for': '1.2.3.4, 10.0.0.1, 10.0.0.2' } }), '1.2.3.4');
        assert.equal(clientIpOf({ headers: { 'x-forwarded-for': '  1.2.3.4  ' } }), '1.2.3.4');
    });

    test('falls back to req.ip then the socket, and finally null', () => {
        assert.equal(clientIpOf({ headers: {}, ip: '5.6.7.8' }), '5.6.7.8');
        assert.equal(clientIpOf({ headers: {}, socket: { remoteAddress: '9.9.9.9' } }), '9.9.9.9');
        assert.equal(clientIpOf({ headers: {} }), null);
        assert.equal(clientIpOf(/** @type {any} */ ({})), null);
    });
});

describe('throttleDecision + recordFailure — the boundaries', () => {
    const now = 1_700_000_000_000;

    test('a first-ever attempt is allowed', () => {
        assert.deepEqual(throttleDecision(null, now), { allowed: true, retryAfterSec: 0 });
    });

    test('a corrupt or partial stored document allows rather than blocks', () => {
        // Fail OPEN on unreadable state: a source that can never attempt again because its document
        // is malformed is a permanent lockout nobody can diagnose, and the PIN is still required.
        for (const s of [{}, { failures: 'x' }, { blockedUntil: 'soon' }, { blockedUntil: null }, 'nonsense']) {
            assert.equal(throttleDecision(/** @type {any} */ (s), now).allowed, true, JSON.stringify(s));
        }
    });

    test('failures accumulate inside the window and TRIP AT the limit, not past it', () => {
        // `>=` not `>`. With `>` the source gets maxFailures + 1 guesses per window — the sort of
        // off-by-one a test asserting "31 is blocked" would happily confirm as correct.
        let state = null;
        for (let i = 1; i < T.maxFailures; i++) {
            state = recordFailure(state, now, T);
            assert.equal(state.failures, i);
            assert.equal(state.blockedUntil, 0, `blocked early at failure ${i}`);
        }
        state = recordFailure(state, now, T);
        assert.equal(state.failures, T.maxFailures);
        assert.equal(state.blockedUntil, now + T.blockMs);
        assert.equal(throttleDecision(state, now).allowed, false);
    });

    test('a block reports a positive Retry-After and LIFTS on its own', () => {
        const blocked = { failures: T.maxFailures, windowStart: now, blockedUntil: now + T.blockMs };
        const d = throttleDecision(blocked, now);
        assert.equal(d.allowed, false);
        assert.ok(d.retryAfterSec > 0 && d.retryAfterSec <= T.blockMs / 1000);
        // The exact instant it expires, and one ms after: allowed. There is no permanent state.
        assert.equal(throttleDecision(blocked, now + T.blockMs).allowed, true);
        assert.equal(throttleDecision(blocked, now + T.blockMs + 1).allowed, true);
    });

    test('the window is ROLLING — an expired window RESTARTS at one, it does not resume', () => {
        // This is what stops an office that mistypes a handful of times a week from eventually
        // being blocked for good by an ever-growing counter.
        const old = { failures: T.maxFailures - 1, windowStart: now, blockedUntil: 0 };
        const next = recordFailure(old, now + T.windowMs + 1, T);
        assert.equal(next.failures, 1);
        assert.equal(next.windowStart, now + T.windowMs + 1);
        assert.equal(next.blockedUntil, 0);
    });

    test('a failure one millisecond INSIDE the window still counts toward it', () => {
        const old = { failures: 4, windowStart: now, blockedUntil: 0 };
        const next = recordFailure(old, now + T.windowMs - 1, T);
        assert.equal(next.failures, 5);
        assert.equal(next.windowStart, now, 'the window must not slide forward on each failure');
    });

    test('the shipped limit is generous for a station and tight for a script', () => {
        // Sized against a real deployment where every PC shares one corporate NAT address. If these
        // ever drop to login-like numbers, the whole of Marylebone gets locked out by two people
        // fumbling; if they rise far, 10,000 guesses stops being a meaningful wall.
        assert.ok(T.maxFailures >= 20, 'too tight for a shared corporate address');
        assert.ok(T.maxFailures <= 60, 'too loose to be a brute-force wall');
        const perDay = T.maxFailures * (86_400_000 / (T.windowMs + T.blockMs));
        assert.ok(perDay < 10000 / 2, `a full traversal would take under two days (${Math.round(perDay)}/day)`);
    });

    test('throttleDecision reads only the STAMP, so a config change cannot re-judge a live block', () => {
        const blocked = { failures: 999, windowStart: now, blockedUntil: now + 1000 };
        assert.equal(throttleDecision(blocked, now).allowed, false);
        assert.equal(throttleDecision(blocked, now + 2000).allowed, true);
    });
});

describe('isThrottleStateStale — the retention rule, stated once', () => {
    const now = 1_700_000_000_000;

    test('a missing document is stale', () => {
        assert.equal(isThrottleStateStale(null, now), true);
    });

    test('a LIVE block is never stale, however old its window', () => {
        // Deleting a document that is still serving a block would clear the block.
        assert.equal(isThrottleStateStale({ windowStart: 0, blockedUntil: now + 1 }, now), false);
    });

    test('an expired window plus an expired block eventually goes', () => {
        const s = { windowStart: now, blockedUntil: 0 };
        assert.equal(isThrottleStateStale(s, now + 1000), false);
        assert.equal(isThrottleStateStale(s, now + T.windowMs + T.blockMs + 1), true);
    });
});

describe('viewerClaims — one capability, and provably not a role', () => {
    test('carries exactly the viewer capability and nothing else', () => {
        assert.deepEqual(viewerClaims(), { calendarViewer: true });
        assert.deepEqual(Object.keys(viewerClaims()), ['calendarViewer']);
    });

    test('carries NONE of the member claims, each asserted by name', () => {
        // Named individually so that adding one is a failure here rather than a review someone has
        // to catch. `setCustomUserClaims` REPLACES the whole set, so this object is the complete
        // and only description of what the shared account can do.
        const c = viewerClaims();
        for (const role of ['name', 'admin', 'manager', 'linksDesigner']) {
            assert.equal(role in c, false, `the viewer must never carry \`${role}\``);
        }
    });

    test('returns a FRESH object each time, so a caller cannot mutate the shared one', () => {
        const a = viewerClaims();
        a.admin = true;
        assert.equal('admin' in viewerClaims(), false);
    });
});

describe('the viewer account is invisible to staff enumeration', () => {
    test('the uid is not an email and would never derive one', () => {
        // `computeOrphanLabels` disables any `@myb-roster.local` account not on the roster, and
        // `getSignInStats` counts from an allowlist of derived member emails. The viewer is created
        // with NO email at all, so it is outside both by construction — but only while the uid
        // stays a uid. A viewer given a member-shaped email would be swept as a leaver on the next
        // "Set up accounts" run, and the PIN would stop working with no obvious cause.
        assert.equal(CALENDAR_VIEWER_UID.includes('@'), false);
        assert.equal(CALENDAR_VIEWER_UID.includes('myb-roster.local'), false);
    });

    test('the real orphan filter does not match an emailless viewer account', () => {
        // Asserted against the ACTUAL function, not a restatement of its rule.
        const { computeOrphanLabels } = require('./functions/roster-parse-helpers.js');
        const users = [
            { uid: CALENDAR_VIEWER_UID, displayName: 'Calendar viewer (shared staff access)', disabled: false },
            { uid: 'x', email: 'g.miller@myb-roster.local', displayName: 'G. Miller', disabled: false },
        ];
        const orphans = computeOrphanLabels(users, new Set());
        assert.equal(orphans.some(o => o.uid === CALENDAR_VIEWER_UID), false,
            'the leaver sweep would disable the viewer account');
        assert.equal(orphans.length, 1, 'the real leaver should still be caught');
    });

    test('the sign-in stats allowlist cannot include the viewer', () => {
        const { summariseSignIns } = require('./functions/roster-parse-helpers.js');
        const now = Date.now();
        const users = [
            { uid: CALENDAR_VIEWER_UID, metadata: { lastSignInTime: new Date(now).toISOString() } },
            { uid: 'x', email: 'g.miller@myb-roster.local', metadata: { lastSignInTime: new Date(now).toISOString() } },
        ];
        const stats = summariseSignIns(users, now, new Set(['g.miller@myb-roster.local']));
        // Whatever the shape of the stats object, the emailless viewer must not be counted:
        // exactly one allowlisted account exists.
        assert.equal(stats.total, 1, `the viewer was counted as staff: ${JSON.stringify(stats)}`);
    });

    test('PIN_LENGTH agrees on both sides of the ESM/CommonJS boundary', () => {
        assert.equal(PIN_LENGTH, 4);
    });
});
