// @ts-check
/**
 * calendar-access-core.js — the PURE rules of Calendar access. No DOM, no Firebase, no storage.
 *
 * WHY A SEPARATE CORE. The Calendar is the app's front door and its most-used surface, so the
 * decision "may this browser see the roster?" is the single highest-traffic branch in the codebase.
 * Everything about that decision that can be decided from plain values is decided here, because the
 * module that owns the Firebase and DOM half (`calendar-access.js`) cannot be loaded in Node at all
 * — it imports the gstatic SDK. That is the same split, and the same reason, as
 * `auth-state-core.js` vs `auth-state.js`, and `client-errors.js` vs `error-reporter.js`.
 *
 * ── THE STAFF PIN IS RETIRED (owner, 23 Nov 2026) ─────────────────────────────────────────────────
 *
 * Only a member's own sign-in opens the Calendar now. What is left of the shared viewer here is
 * TRANSITION plumbing, kept until the cleanup release deletes the `calendar-viewer` account: its uid
 * and claim, and `isViewerUser`, so a device still holding a viewer session is RECOGNISED — refused a
 * grant here, and signed out by `reconcileExpiredIdentity` (session.js) or before a member's sign-in
 * (`shedCalendarViewer`, viewer-shed.js). Nothing in this file grants a viewer any more, and no
 * client file asks for, shapes or compares a PIN.
 *
 * ── THE TWO RULES THAT MUST SURVIVE AN EDIT ─────────────────────────────────────────────────────
 *
 * 1. **`decideAccess` grants a NAMED member and nobody else.** A leftover viewer session is not a
 *    member: it carries no `name` claim, and it has no email — so rule 1's email check alone would
 *    let it through beside a held local session, which is why rule 1 still refuses it by uid.
 *
 * 2. **`none` is the answer whenever anything is missing.** There is no partial state and there
 *    must never be one: a Calendar that renders the base roster without overrides shows somebody
 *    their ORIGINAL shift rather than the one they are working, which is worse than showing nothing
 *    at all. Every ambiguous input resolves to `none` — a locked Calendar is a visible failure and a
 *    wrong Calendar is an invisible one.
 */

import { nameToEmail } from './auth-identity.js';

/** The dedicated Firebase Auth UID for the RETIRED shared staff Calendar viewer (kept until the cleanup
 *  release, so a leftover session is recognised and signed out). Not a member, not an email
 *  account — deliberately created with NO email so the roster's leaver sweep (`computeOrphanLabels`
 *  filters on `@myb-roster.local`) and the sign-in stats allowlist can never see it as staff. */
export const CALENDAR_VIEWER_UID = 'calendar-viewer';

/** The one custom claim the viewer carries. Named as a CAPABILITY, not a role, because that is what
 *  it is — `firestore.rules` reads it to allow override READS and nothing else. */
export const CALENDAR_VIEWER_CLAIM = 'calendarViewer';

/**
 * Is this Firebase user the (retired) shared Calendar viewer? Kept until the cleanup release.
 *
 * Checks the UID, and requires the user to be non-anonymous. An anonymous user can never hold this
 * uid, so the second half is belt-and-braces. Every caller now uses it to RECOGNISE a leftover viewer
 * session: to refuse it a grant (`decideAccess`), to sign it out without touching this browser's push
 * record (`reconcileExpiredIdentity`), and to shed it before a member's sign-in (viewer-shed.js).
 *
 * @param {{ uid?: string, isAnonymous?: boolean }|null|undefined} user
 * @returns {boolean}
 */
export function isViewerUser(user) {
    if (!user || typeof user !== 'object') return false;
    if (user.isAnonymous) return false;
    return user.uid === CALENDAR_VIEWER_UID;
}

/**
 * May a one-time notice OPEN, given the access this browser holds? (v21.81)
 *
 * Every notice is addressed to a member signed in on this device (`named`): anything about your pay,
 * your settings or your account. The two other audiences — `'signed-out'` and `'everyone'` — existed
 * for the staff PIN, a station rather than a person, and went with it (owner, 23 Nov 2026); no live
 * notice used either. A Calendar nobody is signed in to shows no roster and opens no notice.
 *
 * So the one audience is `'members'`, and anything else — a notice still declaring a retired
 * audience, or a typo — is refused, deliberately: the cost of failing closed is a notice that does
 * not appear and is noticed in testing.
 *
 * A suppressed notice must be left UNFLAGGED by its caller — not marked seen — so it arrives when
 * the same device is next signed in.
 *
 * @param {'members'|string} audience  as declared by the notice
 * @param {'named'|'none'|string} accessType  getAccessType()
 * @returns {boolean}
 */
export function noticeAudienceAllows(audience, accessType) {
    return audience === 'members' && accessType === 'named';
}

/**
 * May the day panel offer a PERSONAL action — "Leave dates", "Pay estimate"? (v23.04)
 *
 * Both buttons are addressed to a PERSON, not to a date. "Leave dates" opens Admin's record of
 * *your* annual leave; "Pay estimate" opens *your* calculator, against pay data stored per member
 * on this device. Neither has a meaning on a day belonging to somebody else, and neither has one at
 * all on a station PC — the same reasoning `noticeAudienceAllows` above applies to notices, carried
 * one step further, because a button is a stronger claim than a notice: it says *this will show you
 * yours*, and following it to a colleague's roster day and arriving at your own leave list is a
 * contradiction the member has to work out for themselves. Reported by the owner, 6 Sep 2026: the
 * confusion is the cost, and doubt about the app is the compounding one.
 *
 * TWO REFUSALS, AND THE SECOND DOES NOT SUBSUME THE FIRST — which is the whole reason this is a
 * function and not an `=== ` beside the buttons.
 *
 *   1. **Only on a NAMED grant**, whatever the device remembers. The name can still be in
 *      localStorage when the Calendar was not granted to it — an identity that failed to restore (on
 *      iPhones, an IndexedDB read that fails — KNOWN_LIMITATIONS → "One interaction to expect on
 *      iOS") leaves a valid 60-day local session behind a locked page — so the session's name alone
 *      is not enough. (Until the staff PIN was retired, 23 Nov 2026, this refused `viewer`: the
 *      shared screen that state reached. Asking for `named` refuses that and anything after it.)
 *   2. **The calendar on screen must be the signed-in member's own.** The member selector is open
 *      to every signed-in member — looking at a colleague's roster is an ordinary thing to do — and
 *      an action that silently switches subject is worse than one that is absent.
 *
 * An absent, blank or unmatched name is a refusal — the buttons are a convenience, and the cost of
 * failing closed is a member using the nav drawer instead.
 *
 * @param {object} input
 * @param {'named'|'none'|string} input.accessType  getAccessType()
 * @param {string|null|undefined} input.sessionName   the signed-in member (getSession()?.name)
 * @param {string|null|undefined} input.shownMember   whose calendar is on screen
 * @returns {boolean}
 */
export function personalActionsAllowed({ accessType, sessionName, shownMember }) {
    if (accessType !== 'named') return false;
    const who = typeof sessionName === 'string' ? sessionName.trim() : '';
    const shown = typeof shownMember === 'string' ? shownMember.trim() : '';
    return !!who && who === shown;
}

/**
 * Decide what kind of Calendar access this browser has RIGHT NOW.
 *
 * @param {object} input
 * @param {{ name?: string|null }|null|undefined} input.session  the local MYB session (getSession())
 * @param {{ uid?: string, isAnonymous?: boolean, email?: string|null }|null|undefined} input.firebaseUser  auth.currentUser
 * @returns {'named'|'none'}
 */
export function decideAccess({ session, firebaseUser }) {
    const named = !!(session && typeof session.name === 'string' && session.name.trim());
    const u = firebaseUser || null;

    // Rule 1: a live named session backed by a restored named Firebase identity.
    // BOTH halves are required, and each rejects a real case the other cannot see:
    //   · session without a Firebase user — the identity can fail to restore (on iPhones an
    //     IndexedDB read can fail; Safari's seven-day rule is NOT this case, since it deletes the
    //     session too), so a member can hold a valid 60-day local session with no restorable
    //     identity. Reads would then be denied by the rules and the Calendar would silently show
    //     the base roster.
    //   · Firebase user without a session — that is precisely what `reconcileExpiredIdentity` exists
    //     to tear down. Trusting it here would let an expired member keep their privileges.
    //   · a Firebase user who is somebody ELSE (v24.38). On a shared browser another tab can sign a
    //     different member in; the page would then show the session's name while that person's
    //     token did the reads. An account carrying an email must carry THIS member's.
    //   · the retired staff PIN's viewer (kept until the cleanup release). It has no email, so the
    //     check above would pass it beside a held session; it is refused by uid instead.
    if (named && u && !u.isAnonymous && !isViewerUser(u)
        && (!u.email || u.email === nameToEmail(String(session?.name).trim()))) return 'named';

    // Rule 2: everything else — a leftover staff-PIN viewer (retired 23 Nov 2026: the gate's teardown
    // signs it out, `reconcileExpiredIdentity`, and the sign-in card says why), and an anonymous
    // identity, which used to be the Calendar's whole auth model and now grants nothing.
    return 'none';
}

// There is no second, narrower answer. `decideProvisionalAccess` — a member-scoped paint of this
// device's own cached roster before `decideAccess` could say `named` (v22.97) — was RETIRED on
// 26 Sep 2026 by owner decision: the cache read it relied on queues behind the same Firebase Auth
// start-up it was meant to overtake, so it could not win. DECISIONS.md → "The provisional paint".

