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
 * ── THE THREE RULES THAT MUST SURVIVE AN EDIT ───────────────────────────────────────────────────
 *
 * 1. **`decideAccess` prefers NAMED over VIEWER, and the order is load-bearing.** The viewer is a
 *    CAPABILITY ("may read Calendar override data"), not a person. If a member has a live named
 *    session, answering `viewer` would hand the app an identity with no `name` claim — every
 *    on-behalf write, every owner-scoped read, and every member-personalised branch would then be
 *    deciding against the wrong thing. A named session always wins.
 *
 * 2. **`none` is the answer whenever anything is missing.** There is no partial state and there
 *    must never be one: a Calendar that renders the base roster without overrides shows somebody
 *    their ORIGINAL shift rather than the one they are working, which is worse than showing nothing
 *    at all. Every ambiguous input resolves to `none` — a locked Calendar is a visible failure and a
 *    wrong Calendar is an invisible one.
 *
 * 3. **The PIN never reaches a comparison in this file, or any client file.** These helpers shape
 *    and validate the INPUT (digits, length) so the UI can enable a button; they do not and must
 *    not know the value. A client-side comparison — even against a hash — turns a 10,000-space
 *    secret into an offline brute force that needs no network and leaves no trace. Validation is
 *    the server's, always. Contract B of `calendar-viewer-parity.test.mjs` fails the build if the
 *    PIN's shapes appear anywhere in the repository. (This comment used to name a dedicated
 *    `calendar-secret-hygiene.test.mjs` that never existed — the kind of phantom citation that gets
 *    a real guard deleted by someone who believes another file has it covered.)
 */

/** The dedicated Firebase Auth UID for the shared staff Calendar viewer. Not a member, not an email
 *  account — deliberately created with NO email so the roster's leaver sweep (`computeOrphanLabels`
 *  filters on `@myb-roster.local`) and the sign-in stats allowlist can never see it as staff. */
export const CALENDAR_VIEWER_UID = 'calendar-viewer';

/** The one custom claim the viewer carries. Named as a CAPABILITY, not a role, because that is what
 *  it is — `firestore.rules` reads it to allow override READS and nothing else. */
export const CALENDAR_VIEWER_CLAIM = 'calendarViewer';

/** Digits in the staff PIN. The VALUE lives only in Secret Manager; this is its shape. */
export const PIN_LENGTH = 4;

/**
 * Is this Firebase user the shared Calendar viewer?
 *
 * Checks the UID, and requires the user to be non-anonymous. An anonymous user can never hold this
 * uid, so the second half is belt-and-braces — but it is the belt that matters: every caller uses
 * this to decide whether an identity may be PRESERVED across `reconcileExpiredIdentity`, and a
 * predicate that could ever return true for an unverified identity would turn that preservation
 * into a bypass.
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
 * A PIN unlock is a STATION, not a person. It is deliberately unattributable — one code for the
 * whole place — so a notice written in the second person is addressed to nobody in particular, and
 * a notice asking the reader to go and check their own payslips is addressed to a machine that
 * holds no payslips. Until now every notice opened on `calendarAccessReady` alone, which is the
 * moment access is granted and says nothing about WHOSE it is.
 *
 * So each notice declares its audience, and the DEFAULT is the narrow one:
 *
 *   · `'members'` — a signed-in member on this device (`named`). Anything about your pay, your
 *     settings or your account belongs here.
 *   · `'signed-out'` — ONLY where no member is signed in on this device (a PIN unlock, or the
 *     Calendar with the PIN switched off). For a notice whose subject is signing in: telling
 *     somebody who already has to sign in is noise, and the audience check re-runs on every load,
 *     so such a notice retires itself the moment they do. That is why it needs no done-flag
 *     plumbing to stop, unlike a notice that merely expires.
 *   · `'everyone'` — both. Rarely right; reach for one of the two above first.
 *
 * An unrecognised audience is treated as `'members'`, deliberately: the cost of failing closed is a
 * notice that does not appear and is noticed in testing, and the cost of failing open is station
 * pay copy on a shared screen.
 *
 * A suppressed notice must be left UNFLAGGED by its caller — not marked seen — so it arrives when
 * the same device is next signed in.
 *
 * @param {'members'|'signed-out'|'everyone'|string} audience  as declared by the notice
 * @param {'named'|'viewer'|'open'|'none'} accessType  getAccessType()
 * @returns {boolean}
 */
export function noticeAudienceAllows(audience, accessType) {
    if (audience === 'everyone') return true;
    if (audience === 'signed-out') return accessType !== 'named';
    return accessType === 'named';
}

/**
 * Decide what kind of Calendar access this browser has RIGHT NOW.
 *
 * @param {object} input
 * @param {{ name?: string|null }|null|undefined} input.session  the local MYB session (getSession())
 * @param {{ uid?: string, isAnonymous?: boolean }|null|undefined} input.firebaseUser  auth.currentUser
 * @returns {'named'|'viewer'|'none'}
 */
export function decideAccess({ session, firebaseUser }) {
    const named = !!(session && typeof session.name === 'string' && session.name.trim());
    const u = firebaseUser || null;

    // Rule 1: a live named session backed by a restored named Firebase identity.
    // BOTH halves are required, and each rejects a real case the other cannot see:
    //   · session without a Firebase user — iOS ITP evicts IndexedDB after ~7 days of no PWA use,
    //     so a member can hold a valid 60-day local session with no restorable identity (a window
    //     that doubled at v20.47 with `SESSION_MS`). Reads would then be denied by the rules and
    //     the Calendar would silently show the base roster.
    //   · Firebase user without a session — that is precisely what `reconcileExpiredIdentity` exists
    //     to tear down. Trusting it here would let an expired member keep their privileges.
    if (named && u && !u.isAnonymous && !isViewerUser(u)) return 'named';

    // Rule 2: the shared viewer capability, restored from this browser SESSION (never longer).
    if (isViewerUser(u)) return 'viewer';

    // Rule 3: everything else — including an anonymous identity, which used to be the Calendar's
    // whole auth model and now grants nothing.
    return 'none';
}

/**
 * MAY WE PAINT THIS MEMBER'S OWN CACHED ROSTER WHILE FIREBASE IS STILL CHECKING? (v22.96)
 *
 * ── THE DECISION THIS ENCODES, AND WHOSE IT WAS ─────────────────────────────────────────────────
 *
 * An owner decision of 5 Sep 2026, taken on measurement: 454 of 462 attributed Calendar starts are
 * served from the device's own saved copy, and 78% of those still take over a second to put shifts
 * on screen. The roster is already on the phone; it is waiting for permission. `decideAccess` below
 * requires a restored Firebase user, and getting one costs an `accounts:lookup` round trip that the
 * field data now confirms is the wall.
 *
 * This answers a DIFFERENT and much narrower question than `decideAccess`, and the difference is
 * the whole safety argument. `decideAccess` asks "may this browser read override data?" — server
 * reads, every member, writes downstream. This asks only: *may we re-show this person the data this
 * device already holds for them, for the seconds while their stored identity is revalidated?*
 *
 * ── WHY THE TRADE IS SMALLER THAN IT FIRST LOOKS ────────────────────────────────────────────────
 *
 * The app ALREADY does this when the network is down. Firebase restores a stored user without
 * completing `accounts:lookup` when it cannot reach the endpoint (measured in
 * experiments/auth-firestore-split-proof), so "previously stored identity ⇒ locally stored roster"
 * is today's behaviour offline. What was odd is that a mediocre connection was treated more
 * strictly than no connection at all.
 *
 * It is still a real policy choice and must not be described as merely an optimisation: a member
 * whose account was disabled since their last visit can see their own previously cached roster for
 * the length of the validation window.
 *
 * ── WHAT IT DOES NOT LICENSE ────────────────────────────────────────────────────────────────────
 *
 * Returning `'own-cached'` is not access. The caller must still refuse, until `decideAccess` says
 * `'named'`: any SERVER read, any write, any other member's cached data, entering Team View, and
 * every other protected page. The gate that enforces the member scope is `calendar-overrides.js`;
 * this function only says whose name it may be scoped to.
 *
 * A SESSION IS NOT AN IDENTITY, and that is exactly what makes this a decision rather than a bug
 * fix. The local session is a localStorage record this device wrote for itself — it proves somebody
 * signed in on this device inside the window, not that they still may. That is why the answer is
 * confined to data the same device already received while genuinely authorised.
 *
 * ── THE TWO PRECONDITIONS BEYOND THE SESSION, AND WHY THEY ARE HERE ─────────────────────────────
 *
 * The scope is ONE member, so the paint is only honest if that member is who the screen was about
 * to show. Both of the ways it might not be are settled HERE, at the decision, rather than by
 * disabling things afterwards — a precondition that refuses costs a member the fast path and
 * nothing else, where a half-painted screen being corrected costs them a wrong answer first.
 *
 *   · `teamView` — the saved view mode. Team View is the whole team at once, so a scoped paint
 *     would draw fifty colleagues from the base roster with one person's leave applied. It cannot
 *     be narrowed; it is simply not eligible, and that member boots exactly as they do today.
 *   · `selectedMember` — the name the grid was going to render. It is a stored preference and can
 *     be a COLLEAGUE: staff look each other up. Painting then means showing that colleague's base
 *     roster with their annual leave and absence silently missing — the one thing
 *     `CALENDAR_DATA.md` invariant 1 exists to prevent, arrived at from a new direction. If the
 *     screen is not about to show you, there is nothing of yours to re-show.
 *
 * @param {{ session: any, teamView?: boolean, selectedMember?: string|null }} input
 * @returns {{ decision: 'own-cached'|'none', member: string|null }}
 */
export function decideProvisionalAccess({ session, teamView = false, selectedMember = null } = /** @type {any} */ ({})) {
    const name = session && typeof session.name === 'string' ? session.name.trim() : '';
    // No name, no scope. There is no such thing as an unscoped provisional grant here: the member
    // IS the boundary, so a grant we cannot attach a name to would be a grant to everything.
    if (!name) return { decision: 'none', member: null };
    if (teamView === true) return { decision: 'none', member: null };
    // An ABSENT selection is fine and common — a device that has never chosen renders the session
    // member. Only a selection naming somebody ELSE disqualifies.
    const shown = typeof selectedMember === 'string' ? selectedMember.trim() : '';
    if (shown && shown !== name) return { decision: 'none', member: null };
    // The scope is the SESSION name. Past the refusal above, `shown` is either empty or exactly
    // this name, so the two are indistinguishable here and no test can separate them — the
    // property is held by that refusal, not by this line. Stated because the line looks like a
    // choice and is not one: it becomes a real choice the moment somebody relaxes the refusal.
    return { decision: 'own-cached', member: name };
}

/**
 * Reduce raw field input to a PIN candidate: digits only, never longer than the PIN.
 *
 * Digits-only rather than a `type="number"` field, because a number input on a phone brings a
 * spinner, accepts `e`/`-`/`.`, and reports an empty string for anything it considers invalid — so
 * the field would silently lose what was typed. Stripping here keeps the input a plain text field
 * whose value is always exactly what the user can see.
 *
 * @param {string|null|undefined} raw
 * @returns {string}
 */
export function normalisePin(raw) {
    if (typeof raw !== 'string') return '';
    return raw.replace(/\D+/g, '').slice(0, PIN_LENGTH);
}

/** @param {string} pin @returns {boolean} is this a submittable PIN? */
export function isCompletePin(pin) {
    return typeof pin === 'string' && pin.length === PIN_LENGTH && /^\d+$/.test(pin);
}

/**
 * Turn an unlock failure into the state the UI shows.
 *
 * Every branch returns a `message` written for a staff member standing at a shared PC, and a
 * `retryable` flag. The distinction that matters is **"you typed the wrong thing"** versus
 * **"the app could not ask"** — conflating them (which one generic "couldn't unlock" would do)
 * sends somebody hunting for a PIN that was right all along.
 *
 * Deliberately says nothing about rate-limit internals: how many attempts remain, when the window
 * opened, or what the threshold is. That is not coyness for its own sake — those are exactly the
 * numbers an automated traversal would use to pace itself under the limit.
 *
 * @param {{ status?: number|null, code?: string|null, offline?: boolean }} info
 * @returns {{ kind: 'rejected'|'throttled'|'offline'|'network'|'auth'|'server', message: string, retryable: boolean }}
 */
export function classifyUnlockFailure({ status = null, code = null, offline = false } = {}) {
    // Offline is checked FIRST and beats any status, because a browser that is genuinely offline can
    // still surface a stale/synthesised response — and "check your connection" is actionable where
    // "PIN not recognised" would be a lie that costs somebody three more attempts.
    if (offline) {
        return { kind: 'offline', retryable: true,
                 message: 'You need to be online once to unlock the Calendar. Reconnect and try again.' };
    }
    if (status === 429) {
        return { kind: 'throttled', retryable: true,
                 message: 'Too many attempts. Try again shortly.' };
    }
    if (status === 401 || status === 403) {
        return { kind: 'rejected', retryable: true,
                 message: 'PIN not recognised. Try again.' };
    }
    // A custom-token sign-in that fails after the server said yes. The PIN was RIGHT, so saying
    // "not recognised" would send the member to look for a different code that does not exist.
    if (code) {
        return { kind: 'auth', retryable: true,
                 message: 'Calendar couldn\'t be unlocked. Try again in a moment.' };
    }
    if (status === null) {
        return { kind: 'network', retryable: true,
                 message: 'Calendar couldn\'t be unlocked. Check the connection and try again.' };
    }
    return { kind: 'server', retryable: true,
             message: 'Calendar couldn\'t be unlocked. Try again shortly.' };
}

/**
 * Client-side progressive delay after consecutive failures, in milliseconds.
 *
 * This is a UX control, NOT a security control, and the difference is worth stating because the
 * shape looks identical to one. It exists to absorb a stuck key or a doubled tap and to make a
 * repeated failure feel deliberate rather than ignored. It is trivially bypassed by anyone who
 * opens a console, which is fine: the real limit is the server's, and nothing here is load-bearing
 * for it. Never move enforcement to this side, and never let a longer client delay be an argument
 * for a looser server one.
 *
 * @param {number} failures  consecutive failed attempts this session
 * @returns {number} ms to disable the submit control for
 */
export function attemptBackoffMs(failures) {
    const n = Number.isFinite(failures) ? Math.max(0, Math.floor(failures)) : 0;
    if (n < 3) return 0;
    // 3rd → 2s, 4th → 4s, 5th → 8s, capped at 20s. A cap, because an uncapped client delay on a
    // control the server already limits only punishes the member who mistyped twice.
    return Math.min(20000, 2000 * Math.pow(2, n - 3));
}
