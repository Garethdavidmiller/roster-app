/**
 * calendar-access-core.test.mjs — the Calendar access decision, pinned.
 * Run: node scripts/run-tests.mjs test/calendar-access-core.test.mjs   (part of `npm run test:hygiene`)
 *
 * WHY THESE CASES AND NOT A MATRIX. `decideAccess` has two inputs and three outputs, so a full
 * matrix is nine trivially-passing assertions that would all still pass if the function returned
 * `named` for a viewer. The cases below are chosen the other way round: each one is a state the
 * SHIPPED app can genuinely be in, and each has a specific wrong answer that would ship a bug.
 *
 * The two that matter most are the halves of the `named` rule, because each rejects a real
 * situation the other cannot see — a local session with no restorable Firebase identity (on an
 * iPhone its IndexedDB read can fail; Safari's seven-day rule deletes both), and a Firebase identity
 * with no local session (the exact shape
 * `reconcileExpiredIdentity` exists to tear down). Answering `named` in either case would put the
 * base roster on screen as though it were current, which is the failure the whole feature is
 * built to prevent.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    CALENDAR_VIEWER_UID, CALENDAR_VIEWER_CLAIM,
    isViewerUser, decideAccess, noticeAudienceAllows,
    personalActionsAllowed,
} from '../calendar-access-core.js';

const member  = { uid: 'abc123', isAnonymous: false };
const anon    = { uid: 'anon-1', isAnonymous: true };
const viewer  = { uid: CALENDAR_VIEWER_UID, isAnonymous: false };
const session = { name: 'G. Miller' };

describe('isViewerUser — recognising a leftover session of the retired staff PIN', () => {
    test('recognises the dedicated viewer uid', () => {
        assert.equal(isViewerUser(viewer), true);
    });

    test('an ANONYMOUS user carrying the viewer uid is not the viewer', () => {
        // Belt-and-braces: an anonymous sign-in can never be given this uid. The predicate now decides
        // how a leftover identity is torn down (without releasing this browser's push record) and that
        // `decideAccess` refuses it by uid, so a yes for an unverified identity is still wrong.
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
    test('a Firebase user who is somebody ELSE is not this session\'s member (v24.38)', async () => {
        const { nameToEmail } = await import('../auth-identity.js');
        const s = { name: 'G. Miller' };
        assert.equal(decideAccess({ session: s, firebaseUser: { uid: 'a', isAnonymous: false, email: nameToEmail('G. Miller') } }), 'named');
        assert.equal(decideAccess({ session: s, firebaseUser: { uid: 'b', isAnonymous: false, email: nameToEmail('S. Silva') } }), 'none',
            'another tab signed a colleague in: the page must not show G. Miller over their reads');
    });

    test('a member with a live session and a restored identity → named', () => {
        assert.equal(decideAccess({ session, firebaseUser: member }), 'named');
    });

    test('a member\'s held session over a leftover viewer token is `none` — their own card (audit F1)', () => {
        // NOT `named`: the session says who SHOULD be here, the token is who the reads would run as
        // (AUTH_AND_SESSIONS 17), and the viewer has no email, so only the uid refusal in rule 1 stops
        // it. Their own card goes up, and their sign-in sheds the viewer (viewer-shed.js).
        assert.equal(decideAccess({ session, firebaseUser: viewer }), 'none',
            'a member\'s held session over the shared viewer\'s token must not be granted');
        assert.equal(decideAccess({ session, firebaseUser: member }), 'named');
    });

    test('a session with NO restorable Firebase identity → none, not named', () => {
        // The identity can fail to restore (on an iPhone its IndexedDB read can fail) while the
        // 60-day local session survives. Answering `named` would render the Calendar and let every
        // override read be denied — the base roster, presented as current.
        assert.equal(decideAccess({ session, firebaseUser: null }), 'none');
    });

    test('a Firebase identity with NO local session → none', () => {
        // Precisely what reconcileExpiredIdentity tears down. Trusting it here would let an expired
        // member keep reading the roster indefinitely.
        assert.equal(decideAccess({ session: null, firebaseUser: member }), 'none');
    });

    test('a restored viewer with no session → none: the staff PIN is retired (owner, 23 Nov 2026)', () => {
        // It was `viewer` until the PIN was retired. Now a leftover viewer session opens nothing, even
        // before the boot's teardown (`reconcileExpiredIdentity`) has signed it out.
        assert.equal(decideAccess({ session: null, firebaseUser: viewer }), 'none');
    });

    test('no input can produce any answer but `named` or `none`', () => {
        const sessions = [null, session, { name: '' }];
        const users = [null, member, anon, viewer, { uid: 'x', isAnonymous: false, email: 'someone@example.invalid' }];
        for (const s of sessions) for (const u of users) {
            assert.ok(['named', 'none'].includes(decideAccess({ session: s, firebaseUser: u })),
                `${JSON.stringify(s)} / ${JSON.stringify(u)}`);
        }
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

describe('the constants are the contract', () => {
    test('the viewer uid and claim are exactly what the server and the rules use', () => {
        // These three strings appear in firestore.rules and functions/calendar-viewer-auth.js, on
        // the other side of boundaries this repo cannot cross without a build step.
        // calendar-viewer-parity.test.mjs is what actually pins them together; this states them.
        assert.equal(CALENDAR_VIEWER_UID, 'calendar-viewer');
        assert.equal(CALENDAR_VIEWER_CLAIM, 'calendarViewer');
    });

    test('no PIN helper is left in the client (the staff PIN is retired, 23 Nov 2026)', async () => {
        const core = await import('../calendar-access-core.js');
        for (const gone of ['PIN_LENGTH', 'PIN_FIRST_HASH', 'normalisePin', 'isCompletePin', 'classifyUnlockFailure', 'attemptBackoffMs']) {
            assert.equal(gone in core, false, `${gone} came back`);
        }
    });

    test('the claim is NOT one of the member claims', () => {
        // A capability, not a role. If this ever equalled one of these, the viewer would satisfy a
        // member rule by construction and every other test here would still pass.
        for (const role of ['name', 'admin', 'manager', 'linksDesigner']) {
            assert.notEqual(CALENDAR_VIEWER_CLAIM, role);
        }
    });
});

// ── WHO A NOTICE IS ADDRESSED TO (v21.81; members only since the PIN was retired, 23 Nov 2026) ──────
//
// Reported by the owner the day the PIN went live: the Calendar's one-time notices were opening on
// the station PC, because they waited only for `calendarAccessReady`. Each notice has declared an
// audience since. The two that existed for the PIN — 'signed-out' and 'everyone' — went with it (no
// live notice used either), so the rule is members-only, and refuses anything else.
describe('which devices a notice is addressed to', () => {
    test('a members-only notice reaches a signed-in member and nobody else', () => {
        assert.equal(noticeAudienceAllows('members', 'named'), true);
        assert.equal(noticeAudienceAllows('members', 'none'), false);
        assert.equal(noticeAudienceAllows('members', 'viewer'), false, 'an access type that no longer exists');
    });

    test("the retired audiences, 'signed-out' and 'everyone', reach nobody", () => {
        for (const audience of ['signed-out', 'everyone']) {
            for (const type of ['named', 'none', 'viewer']) {
                assert.equal(noticeAudienceAllows(audience, type), false, `${audience} / ${type}`);
            }
        }
    });

    test('an audience nobody recognises reaches nobody, a signed-in member included', () => {
        // Fails towards the direction whose cost is visible: a notice that does not appear gets
        // noticed in testing.
        for (const audience of ['member', 'Members', 'staff', '', undefined, null]) {
            assert.equal(noticeAudienceAllows(/** @type {any} */ (audience), 'named'), false, String(audience));
        }
    });
});

describe('personalActionsAllowed — a button that says "yours" must mean it', () => {
    // Organised by what each wrong answer COSTS, and they are not symmetrical.
    //
    //   · OFFERING TOO MUCH is the reported defect and the quiet one. Nothing errors: the member
    //     taps "Leave dates" on a colleague's annual-leave day and arrives at a correct, complete
    //     list of their OWN leave, which they then have to work out is not what they asked for.
    //   · OFFERING TOO LITTLE costs a signed-in member on their own calendar one tap through the
    //     nav drawer. Real, and an order of magnitude cheaper, which is why every ambiguous input
    //     below is asserted to refuse.

    const OWN = { accessType: 'named', sessionName: 'G. Miller', shownMember: 'G. Miller' };

    test('your own calendar, signed in — the case both buttons exist for', () => {
        assert.equal(personalActionsAllowed(OWN), true);
    });

    test('a COLLEAGUE’s calendar refuses, however you are signed in', () => {
        // Browsing somebody else's roster is an ordinary thing every signed-in member may do —
        // that is what the member selector is — so this is not an edge case, it is the report.
        for (const type of ['named', 'none']) {
            assert.equal(
                personalActionsAllowed({ ...OWN, accessType: type, shownMember: 'S. Silva' }), false,
                `${type}: a colleague's day must offer no personal action`);
        }
    });

    test('anything but a NAMED grant refuses, even with a live session name', () => {
        // THE CASE AN IDENTITY-ONLY RULE GETS WRONG. A name can still be in localStorage on a page that
        // was not granted to it (an identity that failed to restore leaves a valid 60-day session), so
        // the name alone must not light either button. It was `viewer` mode this refused until the
        // staff PIN was retired; asking for `named` refuses that and every other state.
        for (const type of ['none', 'viewer', '', undefined]) {
            assert.equal(personalActionsAllowed({ ...OWN, accessType: /** @type {any} */ (type) }), false,
                `${String(type)}: a stale local name must not count as a grant`);
        }
    });

    test('no name, a blank name and a missing member all refuse', () => {
        // A convenience fails closed. `undefined === undefined` is TRUE, which is the shape that
        // turns "both unknown" into "it is yours" — asserted rather than reasoned about.
        for (const [who, shown] of [[null, 'G. Miller'], [undefined, undefined], ['', ''],
                                    ['   ', '   '], ['G. Miller', null], ['G. Miller', '']]) {
            assert.equal(personalActionsAllowed({ accessType: 'named', sessionName: who, shownMember: shown }),
                false, `${JSON.stringify(who)} vs ${JSON.stringify(shown)} must refuse`);
        }
    });

    test('the comparison survives stored whitespace, on either side', () => {
        assert.equal(personalActionsAllowed({ ...OWN, sessionName: ' G. Miller ' }), true);
        assert.equal(personalActionsAllowed({ ...OWN, shownMember: 'G. Miller ' }), true);
    });

    test('a non-string on either side is refused rather than coerced', () => {
        for (const bad of [42, {}, [], true]) {
            assert.equal(personalActionsAllowed({ accessType: 'named', sessionName: bad, shownMember: bad }),
                false, `${JSON.stringify(bad)} is not a name`);
        }
    });
});
