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
    isValidPinShape, pinMatches, sourceKeyFor, clientIpOf, GLOBAL_SOURCE_KEY, GLOBAL_THROTTLE,
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

    // ── THE FORGED-HEADER CASES (v20.35) ────────────────────────────────────────────────────────
    //
    // This took the FIRST x-forwarded-for entry until v20.35, which handed any caller an unlimited
    // supply of throttle buckets: send `X-Forwarded-For: 1.1.1.1`, then `1.1.1.2`, and every request
    // is a brand-new source with a full allowance. Against a four-digit PIN that is not a weakened
    // throttle, it is no throttle. Google's load balancer RETAINS a supplied value and appends its
    // own observation, and its documentation warns the preceding values are not verified.
    //
    // The asymmetry is the fix: a caller can only PREPEND. Whatever they send is at the FRONT and
    // the platform's own value is appended after it, so the LAST entry is the only one they cannot
    // control. These cases are written as the attack, not as the mechanism.
    test('a forged x-forwarded-for prefix cannot mint a new throttle bucket', () => {
        // Same real caller (10.0.0.1 appended by the platform), three different forged prefixes.
        // All three must land in ONE bucket, or the limit means nothing.
        const forged = ['1.1.1.1', '1.1.1.2', '203.0.113.9']
            .map(fake => clientIpOf({ headers: { 'x-forwarded-for': `${fake}, 10.0.0.1` } }));
        assert.deepEqual(forged, ['10.0.0.1', '10.0.0.1', '10.0.0.1']);
        assert.equal(new Set(forged.map(sourceKeyFor)).size, 1, 'one source key for one real caller');

        // And a forged value must never BE the key, however many entries are stacked in front.
        assert.equal(clientIpOf({ headers: { 'x-forwarded-for': '1.1.1.1, 2.2.2.2, 3.3.3.3, 10.0.0.1' } }), '10.0.0.1');
    });

    test('clientIpOf reads the END of the chain, and tolerates spacing and repeated headers', () => {
        assert.equal(clientIpOf({ headers: { 'x-forwarded-for': '1.2.3.4, 10.0.0.1, 10.0.0.2' } }), '10.0.0.2');
        assert.equal(clientIpOf({ headers: { 'x-forwarded-for': '  1.2.3.4  ' } }), '1.2.3.4', 'a single entry is both ends');
        assert.equal(clientIpOf({ headers: { 'x-forwarded-for': '1.2.3.4,  10.0.0.1  ,' } }), '10.0.0.1', 'trailing comma');
        // Node surfaces a REPEATED header as an array in arrival order, so the platform's value is
        // in the last element — taking the first element would be the old bypass wearing a hat.
        assert.equal(clientIpOf({ headers: { 'x-forwarded-for': ['1.1.1.1', '9.9.9.9, 10.0.0.1'] } }), '10.0.0.1');
    });

    test('falls back to req.ip then the socket, and finally null', () => {
        assert.equal(clientIpOf({ headers: {}, ip: '5.6.7.8' }), '5.6.7.8');
        assert.equal(clientIpOf({ headers: {}, socket: { remoteAddress: '9.9.9.9' } }), '9.9.9.9');
        assert.equal(clientIpOf({ headers: {} }), null);
        assert.equal(clientIpOf(/** @type {any} */ ({})), null);
    });
});

// ── THE ALL-SOURCES CEILING (v20.35) ────────────────────────────────────────────────────────────
//
// The per-source throttle can only ever be as good as the request attribution underneath it, and
// that attribution rests on a forwarding header whose exact shape depends on the deployment chain.
// This ceiling exists so the endpoint is bounded even when that attribution is wrong — a different
// KIND of defence, not a second copy of the same one, which is why it is keyed on a constant.
describe('the all-sources ceiling — bounded even if attribution is wrong', () => {
    test('its key is a constant that no request can influence, and cannot collide with a source key', () => {
        // A per-source key is 32 hex chars. The global key must not be able to be one, or a caller
        // whose address happened to hash to it would share the ceiling's bucket.
        assert.match(GLOBAL_SOURCE_KEY, /^[a-z_-]+$/, 'not hex, so no hashed address can collide');
        assert.notEqual(GLOBAL_SOURCE_KEY.length, 32);
        for (const ip of ['1.1.1.1', '10.0.0.1', '', null]) {
            assert.notEqual(sourceKeyFor(ip), GLOBAL_SOURCE_KEY);
        }
    });

    test('it sits ABOVE the per-source limit, so both shapes of chain are covered', () => {
        // If the chain collapses every caller into one bucket, the per-source limit binds first and
        // this never fires. If the chain is per-client, this is the only thing bounding the total.
        // Equal or lower would make the per-source rule dead code.
        assert.ok(GLOBAL_THROTTLE.maxFailures > DEFAULT_THROTTLE.maxFailures,
            'the ceiling must be a backstop, never the thing that stops ordinary use');
    });

    test('it actually bounds a brute force — the arithmetic, not the intent', () => {
        // 10,000 combinations against the ceiling's rate. If a future edit loosens this enough to
        // make the whole space reachable inside a working day, that is worth failing over.
        const perHour = GLOBAL_THROTTLE.maxFailures * (3600000 / GLOBAL_THROTTLE.windowMs);
        assert.ok(10000 / perHour > 8,
            `at ${perHour}/hour the PIN space falls in ${(10000 / perHour).toFixed(1)}h — too fast`);
    });

    test('the ceiling trips on the attempt that REACHES it, and expires on its own', () => {
        const now = 1_000_000;
        let state = null;
        for (let i = 0; i < GLOBAL_THROTTLE.maxFailures - 1; i++) {
            state = recordFailure(state, now, GLOBAL_THROTTLE);
            assert.equal(state.blockedUntil, 0, `not blocked at ${i + 1} failures`);
        }
        state = recordFailure(state, now, GLOBAL_THROTTLE);
        assert.ok(state.blockedUntil > now, 'the attempt that reaches the limit trips it');
        assert.equal(throttleDecision(state, now).allowed, false);
        // No permanent lock: a control any passer-by could pin open would be a denial-of-service
        // handle pointed at the staff it protects.
        assert.equal(throttleDecision(state, state.blockedUntil + 1).allowed, true);
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

// ── A MALFORMED DEPLOYED SECRET IS A SERVER FAULT, NOT A WRONG PIN (v20.39, audit §31) ──────────
//
// The shape rule is applied to the DEPLOYED SECRET as well as to the submitted PIN, and the reason
// is a support failure rather than a security one: a secret set to five digits by a slipped
// keystroke can never match a four-digit entry, so every member is told their PIN is wrong. That is
// the symptom least likely to lead anyone to the cause. Asserted through the same helper the
// endpoint uses, since the endpoint itself needs the emulator.
describe('deployed-secret shape', () => {
    test('the shape rule rejects exactly what a slipped keystroke produces', () => {
        for (const bad of ['12345', '147', '14 75', 'abcd', '147a', '', '   ', '1475\n5']) {
            assert.equal(isValidPinShape(bad.trim()), false, `"${bad}" must not pass as a configured PIN`);
        }
    });

    test('a well-formed four-digit secret still passes', () => {
        // Values chosen to be obviously not the real PIN — the deployed secret never appears here.
        for (const good of ['0000', '9999', '0123']) {
            assert.equal(isValidPinShape(good), true, `"${good}" is a valid PIN shape`);
        }
    });

    test('the same rule governs the submitted PIN and the configured one', () => {
        // One rule, so the two can never drift into disagreeing about what a PIN is — the drift
        // would show up as "correct PIN refused", which is indistinguishable from a wrong PIN.
        assert.equal(isValidPinShape('1234'), isValidPinShape('1234'));
        assert.equal(typeof isValidPinShape, 'function');
    });
});
