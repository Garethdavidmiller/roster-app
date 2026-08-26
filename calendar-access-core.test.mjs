/**
 * calendar-access-core.test.mjs — the Calendar access decision, pinned.
 * Run: node --test calendar-access-core.test.mjs   (part of `npm run test:hygiene`)
 *
 * WHY THESE CASES AND NOT A MATRIX. `decideAccess` has two inputs and three outputs, so a full
 * matrix is nine trivially-passing assertions that would all still pass if the function returned
 * `named` for a viewer. The cases below are chosen the other way round: each one is a state the
 * SHIPPED app can genuinely be in, and each has a specific wrong answer that would ship a bug.
 *
 * The two that matter most are the halves of the `named` rule, because each rejects a real
 * situation the other cannot see — a local session with no restorable Firebase identity (iOS ITP
 * evicts IndexedDB after ~7 days), and a Firebase identity with no local session (the exact shape
 * `reconcileExpiredIdentity` exists to tear down). Answering `named` in either case would put the
 * base roster on screen as though it were current, which is the failure the whole feature is
 * built to prevent.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    CALENDAR_VIEWER_UID, CALENDAR_VIEWER_CLAIM, PIN_LENGTH,
    isViewerUser, decideAccess, normalisePin, isCompletePin,
    classifyUnlockFailure, attemptBackoffMs, noticeAudienceAllows,
} from './calendar-access-core.js';

const member  = { uid: 'abc123', isAnonymous: false };
const anon    = { uid: 'anon-1', isAnonymous: true };
const viewer  = { uid: CALENDAR_VIEWER_UID, isAnonymous: false };
const session = { name: 'G. Miller' };

describe('isViewerUser — the predicate that decides what may be PRESERVED', () => {
    test('recognises the dedicated viewer uid', () => {
        assert.equal(isViewerUser(viewer), true);
    });

    test('an ANONYMOUS user carrying the viewer uid is not the viewer', () => {
        // Belt-and-braces: an anonymous sign-in can never be given this uid. But this predicate is
        // what `reconcileExpiredIdentity({ preserveCalendarViewer: true })` consults to decide
        // whether to LEAVE an identity in place, so a version of it that could ever say yes to an
        // unverified identity would turn that preservation into a bypass.
        assert.equal(isViewerUser({ uid: CALENDAR_VIEWER_UID, isAnonymous: true }), false);
    });

    test('says no to a member, an anonymous session, null and rubbish', () => {
        assert.equal(isViewerUser(member), false);
        assert.equal(isViewerUser(anon), false);
        assert.equal(isViewerUser(null), false);
        assert.equal(isViewerUser(undefined), false);
        assert.equal(isViewerUser(/** @type {any} */ ('calendar-viewer')), false);
    });
});

describe('decideAccess', () => {
    test('a member with a live session and a restored identity → named', () => {
        assert.equal(decideAccess({ session, firebaseUser: member }), 'named');
    });

    test('NAMED BEATS VIEWER — a member holding a viewer session is still a member', () => {
        // Order matters. Answering `viewer` would hand the app an identity with no `name` claim, so
        // every owner-scoped read and on-behalf write would then be deciding against the wrong
        // thing — while the member appears, to themselves, to be signed in.
        assert.equal(decideAccess({ session, firebaseUser: viewer }), 'viewer');
        // ...but only because the Firebase identity genuinely IS the viewer. With a member identity
        // present, the session wins:
        assert.equal(decideAccess({ session, firebaseUser: member }), 'named');
    });

    test('a session with NO restorable Firebase identity → none, not named', () => {
        // iOS ITP evicts IndexedDB after ~7 days of no PWA use, so a member can hold a valid 30-day
        // local session and no identity at all. Answering `named` would render the Calendar and let
        // every override read be denied — the base roster, presented as current.
        assert.equal(decideAccess({ session, firebaseUser: null }), 'none');
    });

    test('a Firebase identity with NO local session → none', () => {
        // Precisely what reconcileExpiredIdentity tears down. Trusting it here would let an expired
        // member keep reading the roster indefinitely.
        assert.equal(decideAccess({ session: null, firebaseUser: member }), 'none');
    });

    test('a restored viewer with no session → viewer', () => {
        assert.equal(decideAccess({ session: null, firebaseUser: viewer }), 'viewer');
    });

    test('ANONYMOUS GRANTS NOTHING — the whole point of the change', () => {
        // The Calendar used to sign every visitor in anonymously. If this returned anything but
        // `none`, the feature would be re-admitting exactly the people it closes out.
        assert.equal(decideAccess({ session: null, firebaseUser: anon }), 'none');
        assert.equal(decideAccess({ session, firebaseUser: anon }), 'none');
    });

    test('a blank or whitespace session name is not a session', () => {
        assert.equal(decideAccess({ session: { name: '' }, firebaseUser: member }), 'none');
        assert.equal(decideAccess({ session: { name: '   ' }, firebaseUser: member }), 'none');
    });

    test('nothing at all → none', () => {
        assert.equal(decideAccess({ session: null, firebaseUser: null }), 'none');
        assert.equal(decideAccess({}), 'none');
    });
});

describe('PIN input shaping — never a comparison', () => {
    test('strips everything that is not a digit', () => {
        assert.equal(normalisePin('1a2b3c4d'), '1234');
        assert.equal(normalisePin(' 12 34 '), '1234');
        assert.equal(normalisePin('--12'), '12');
    });

    test('never exceeds the PIN length, however much is pasted', () => {
        assert.equal(normalisePin('1234567890').length, PIN_LENGTH);
    });

    test('non-strings are empty, never a thrown error on a keystroke', () => {
        assert.equal(normalisePin(null), '');
        assert.equal(normalisePin(undefined), '');
        assert.equal(normalisePin(/** @type {any} */ (1234)), '');
    });

    test('isCompletePin is a LENGTH check and cannot be a value check', () => {
        assert.equal(isCompletePin('0000'), true);
        assert.equal(isCompletePin('9999'), true);
        assert.equal(isCompletePin('123'), false);
        assert.equal(isCompletePin('12345'), false);
        assert.equal(isCompletePin('12a4'), false);
        assert.equal(isCompletePin(/** @type {any} */ (null)), false);
    });
});

describe('classifyUnlockFailure — the words a member reads', () => {
    test('OFFLINE beats any status', () => {
        // A genuinely offline browser can still surface a synthesised response. Reporting "PIN not
        // recognised" there is a lie that costs somebody three more attempts at a code that works.
        const f = classifyUnlockFailure({ status: 401, offline: true });
        assert.equal(f.kind, 'offline');
        assert.match(f.message, /online/i);
    });

    test('401 and 403 are the same rejection, and say to try again', () => {
        for (const status of [401, 403]) {
            const f = classifyUnlockFailure({ status });
            assert.equal(f.kind, 'rejected');
            assert.match(f.message, /not recognised/i);
            assert.equal(f.retryable, true);
        }
    });

    test('429 says too many attempts and reveals NO limit internals', () => {
        const f = classifyUnlockFailure({ status: 429 });
        assert.equal(f.kind, 'throttled');
        // No count, no window, no threshold — those are the numbers an automated traversal would
        // use to pace itself just under the limit.
        assert.equal(/\d/.test(f.message), false, `leaked a number: ${f.message}`);
    });

    test('a sign-in failure AFTER a correct PIN never says the PIN was wrong', () => {
        // The member typed the right code. Sending them to look for a different one is how a
        // transient auth blip turns into "the PIN has changed and nobody told us".
        const f = classifyUnlockFailure({ code: 'auth/invalid-custom-token' });
        assert.equal(f.kind, 'auth');
        assert.doesNotMatch(f.message, /not recognised/i);
    });

    test('no status at all is a transport failure, not a rejection', () => {
        const f = classifyUnlockFailure({ status: null });
        assert.equal(f.kind, 'network');
        assert.match(f.message, /connection/i);
    });

    test('every branch is retryable — there is no dead end', () => {
        const cases = [{ offline: true }, { status: 429 }, { status: 401 }, { status: 500 },
                       { status: null }, { code: 'x' }, {}];
        for (const c of cases) assert.equal(classifyUnlockFailure(c).retryable, true, JSON.stringify(c));
    });

    test('no branch ever echoes a PIN — there is nowhere for one to enter', () => {
        // The signature takes a status and a code and nothing else, which is the structural
        // guarantee. This asserts the messages carry no digits either, so a future edit cannot
        // start interpolating "you typed 1234" into one.
        const all = [{ offline: true }, { status: 429 }, { status: 401 }, { status: 500 },
                     { status: null }, { code: 'x' }].map(c => classifyUnlockFailure(c).message);
        for (const m of all) assert.equal(/\d/.test(m), false, `message contains a digit: ${m}`);
    });
});

describe('attemptBackoffMs — a UX brake, not a security control', () => {
    test('the first two failures are not delayed at all', () => {
        // A mistyped PIN is the common case and must not feel punitive.
        assert.equal(attemptBackoffMs(0), 0);
        assert.equal(attemptBackoffMs(1), 0);
        assert.equal(attemptBackoffMs(2), 0);
    });

    test('it grows from the third failure', () => {
        assert.equal(attemptBackoffMs(3), 2000);
        assert.equal(attemptBackoffMs(4), 4000);
        assert.equal(attemptBackoffMs(5), 8000);
    });

    test('it is CAPPED — an uncapped client delay only punishes the honest', () => {
        assert.equal(attemptBackoffMs(50), 20000);
        assert.equal(attemptBackoffMs(500), 20000);
    });

    test('junk input never produces NaN or a negative wait', () => {
        for (const v of [-5, NaN, Infinity, /** @type {any} */ ('x'), /** @type {any} */ (null)]) {
            const ms = attemptBackoffMs(v);
            assert.ok(Number.isFinite(ms) && ms >= 0, `bad backoff for ${String(v)}: ${ms}`);
        }
    });
});

describe('the constants are the contract', () => {
    test('the viewer uid and claim are exactly what the server and the rules use', () => {
        // These three strings appear in firestore.rules and functions/calendar-viewer-auth.js, on
        // the other side of boundaries this repo cannot cross without a build step.
        // calendar-viewer-parity.test.mjs is what actually pins them together; this states them.
        assert.equal(CALENDAR_VIEWER_UID, 'calendar-viewer');
        assert.equal(CALENDAR_VIEWER_CLAIM, 'calendarViewer');
        assert.equal(PIN_LENGTH, 4);
    });

    test('the claim is NOT one of the member claims', () => {
        // A capability, not a role. If this ever equalled one of these, the viewer would satisfy a
        // member rule by construction and every other test here would still pass.
        for (const role of ['name', 'admin', 'manager', 'linksDesigner']) {
            assert.notEqual(CALENDAR_VIEWER_CLAIM, role);
        }
    });
});

// ── WHO A NOTICE IS ADDRESSED TO (v21.81) ────────────────────────────────────────────────────────
//
// Reported by the owner the day the PIN went live: the Calendar's one-time notices were opening on
// the station PC, because they waited only for `calendarAccessReady` — the moment access is
// GRANTED, which says nothing about whose it is. One of the two asks the reader to go and check
// their own payslips are entered correctly, on a machine that is deliberately unattributable.
//
// The two failure directions are not symmetrical, which is why the default is the narrow one:
// showing a members-only notice on a shared screen is a fact stated to nobody, while hiding an
// 'everyone' notice takes away the only route the app has to the members who never sign in.
describe('which devices a notice is addressed to', () => {
    test('a members-only notice reaches a signed-in member and nobody else', () => {
        assert.equal(noticeAudienceAllows('members', 'named'), true);
        assert.equal(noticeAudienceAllows('members', 'viewer'), false, 'the station PC — the reported case');
        assert.equal(noticeAudienceAllows('members', 'open'), false, 'PIN access switched off is still no identity');
        assert.equal(noticeAudienceAllows('members', 'none'), false);
    });

    test("an 'everyone' notice reaches the PIN unlock too — that is what it is for", () => {
        // `pw-own-2026` asks the members who never sign in to sign in, and since v20.12 those
        // members reach the Calendar through the PIN. Answering false here would hide it from its
        // entire audience while leaving every test about it passing.
        assert.equal(noticeAudienceAllows('everyone', 'viewer'), true);
        assert.equal(noticeAudienceAllows('everyone', 'named'), true);
        assert.equal(noticeAudienceAllows('everyone', 'open'), true);
    });

    test('an audience nobody recognises is treated as members-only', () => {
        // Fails towards the direction whose cost is visible: a notice that does not appear gets
        // noticed, station pay copy on a shared screen does not.
        for (const audience of ['member', 'Everyone', 'staff', '', undefined, null]) {
            assert.equal(noticeAudienceAllows(/** @type {any} */ (audience), 'viewer'), false);
        }
    });
});
