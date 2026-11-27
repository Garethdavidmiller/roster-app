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
 * Only a member's own sign-in opens the Calendar now. The shared viewer's account was deleted and
 * the last of its transition code went in the cleanup release (27 Nov 2026), so no client file asks
 * for, shapes, compares or recognises a PIN.
 *
 * ── THE TWO RULES THAT MUST SURVIVE AN EDIT ─────────────────────────────────────────────────────
 *
 * 1. **`decideAccess` grants a NAMED member and nobody else.**
 *
 * 2. **`none` is the answer whenever anything is missing.** There is no partial state and there
 *    must never be one: a Calendar that renders the base roster without overrides shows somebody
 *    their ORIGINAL shift rather than the one they are working, which is worse than showing nothing
 *    at all. Every ambiguous input resolves to `none` — a locked Calendar is a visible failure and a
 *    wrong Calendar is an invisible one.
 */

import { nameToEmail } from './auth-identity.js';

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
    if (named && u && !u.isAnonymous
        && (!u.email || u.email === nameToEmail(String(session?.name).trim()))) return 'named';

    // Rule 2: everything else — an anonymous identity included, which used to be the Calendar's whole
    // auth model and now grants nothing.
    return 'none';
}

// There is no second, narrower answer. `decideProvisionalAccess` — a member-scoped paint of this
// device's own cached roster before `decideAccess` could say `named` (v22.97) — was RETIRED on
// 26 Sep 2026 by owner decision: the cache read it relied on queues behind the same Firebase Auth
// start-up it was meant to overtake, so it could not win. DECISIONS.md → "The provisional paint".

