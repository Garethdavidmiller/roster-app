// @ts-check
/**
 * calendar-access.js — the Calendar's access gate: decide, unlock, and hold the answer.
 *
 * Owns: the access decision at boot, the staff-PIN unlock panel, the viewer Firebase session
 *   (mint → session-only persistence → signInWithCustomToken → verify the claim), the
 *   `calendarAccessReady` promise every Calendar subsystem waits on, and re-locking.
 * Does NOT own: the RULES (calendar-access-core.js — pure, tested in Node), override fetching
 *   (calendar-overrides.js), any rendering (calendar-renderer.js / calendar-app.js), or named
 *   member authentication (session.js, which remains the sole authority on who the member is).
 * Edit here for: unlock UI wiring, the exchange call, the access bootstrap order.
 *
 * ── THE POINT OF THE WHOLE MODULE ───────────────────────────────────────────────────────────────
 *
 * `overrides` used to be world-readable (`allow read;`) because the Calendar had no session. It now
 * requires either a real member `name` claim or the shared `calendarViewer` capability. That change
 * is only safe if NOTHING can put roster data on screen before this module has said yes — and the
 * dangerous path is not the network read, which the rules now stop. It is the LOCAL FIRESTORE
 * CACHE: `getDocsFromCache` is served from IndexedDB without contacting the server, so security
 * rules are never consulted. A browser that unlocked yesterday still holds every override it saw.
 *
 * So the gate is structural, not cosmetic: while access is `none`, `calendar-app.js` does not
 * initialise the Calendar AT ALL — no member dropdown, no fetch, no render, no Team View — and
 * `calendar-overrides.js` independently refuses to serve the cache. Two gates, because the first is
 * a call-order property that a future edit could quietly break and the second is a hard refusal
 * that it could not.
 *
 * ── WHAT THE VIEWER IS ──────────────────────────────────────────────────────────────────────────
 *
 * A capability, not a person. It answers "may this browser read the Calendar?" and nothing else.
 * The named-auth state machine (auth-state-core/auth-state/auth-policy) still answers "who is the
 * member?", and was deliberately NOT extended — the viewer is not another value of `named`, it is a
 * different question. Everything member-personalised in the app keys off `getSession()`, which a
 * viewer does not have, so viewer mode cannot reveal a member-only surface by accident.
 *
 * ── PERSISTENCE IS THE SECURITY BOUNDARY, AND IT IS EASY TO UNDO ────────────────────────────────
 *
 * The viewer signs in under `browserSessionPersistence` so it dies with the browser session — which
 * is the entire reason a shared office PC is safe to unlock. Two ways that gets broken:
 *
 *   · Setting long-lived persistence WHILE the viewer is the current user migrates it into
 *     IndexedDB, and it then survives the browser closing. `session.js`'s `_shedCalendarViewer`
 *     therefore signs the viewer OUT before restoring the member persistence chain, never after.
 *   · Recording "unlocked" in localStorage. There is no such flag and there must not be: the
 *     Firebase auth state IS the authority, so there is exactly one thing to get right and no
 *     second copy that can disagree with it.
 *
 * ── THE FRONT DOOR IS SIGN-IN FIRST; THE PIN IS THE FALLBACK (v23.19, owner decision) ────────────
 *
 * A browser holding nothing is shown the member SIGN-IN card (`showSignInPanel` — the shared
 * `login-overlay.js` card, mounted inline), with "Use the staff PIN instead" beneath it. Until
 * v23.18 it was the other way round: the PIN card first and "Sign in instead" as the link. The
 * order was inherited from the PIN's origin as the low-friction answer for shared office PCs, and
 * it had the front door optimised for the minority: most people opening the app are staff with a
 * password of their own, and signing in is what ends the code for them for 60 days. The PIN is for
 * the shared PC, and for visiting or agency staff who need the roster, the Huddle and the guides
 * without an account — a real audience, and one tap away, not the default.
 *
 * Three things the reorder does NOT change, because they are the security model and this is only
 * the order of two cards: what each route GRANTS (`decideAccess` is untouched), that a member is
 * never sent to the PIN (`showMemberPanel` still answers a held session), and that nothing is on
 * screen before access is granted. ONE route asks for the PIN card first: `#staff-pin`, which a
 * "Use the staff PIN instead" sign-out reloads with and a station PC can bookmark — consumed at
 * boot, never stored.
 *
 * The cards share ONE slot (`calendar-lock-slot.js`) so at most one of them can exist at a time.
 */

import { auth, signInWithCustomToken, signInAnonymously, signOut, setViewerPersistence, onAuthStateChanged, currentUserAfterBoot } from './firebase-client.js';
import { getSession, reconcileExpiredIdentity, ensureNamedSession } from './session.js';
import { CONFIG } from './roster-data.js';
import { lsGet } from './ls.js';
import { SELECTED_MEMBER, TEAM_VIEW } from './storage-keys.js';
import { isViewerUser, decideAccess, decideProvisionalAccess, isCompletePin, classifyUnlockFailure, PIN_LENGTH, CALENDAR_VIEWER_CLAIM } from './calendar-access-core.js';
import { lockCardId, armSkeleton, showBootSkeleton } from './calendar-lock-slot.js';
// The three cards this gate can put where the Calendar goes. They DRAW; this file DECIDES —
// the split is along the line this module's own header already stated. `initLockCards` below
// hands them the four collaborators they cannot import back without a cycle.
import { initLockCards, resetUnlockFailures, hideLockPanel, showLockPanel, showSignInPanel,
         showMemberPanel, PIN_FIRST_HASH } from './calendar-lock-cards.js';

/** The exchange endpoint. Same region + project as every other MYB function. */
const UNLOCK_URL = 'https://europe-west2-myb-roster.cloudfunctions.net/unlockCalendarViewer';

/** How long to wait on the exchange before calling it a network failure. Generous — a cold start of
 *  a rarely-called function is a real several seconds, and timing out into "check the connection"
 *  on a working network is the more annoying of the two errors. */
const UNLOCK_TIMEOUT_MS = 15000;

/** The whole access decision's deadline — NOT a per-step one (v21.29). Everything `resolveAccess`
 *  waits for shares this budget, so a wedged auth layer costs it once rather than once per step.
 *  Past it the answer is `none`, which shows the unlock card, which is recoverable — and the
 *  late-identity watcher then corrects it the moment a real identity turns up. */
const ACCESS_DECISION_BUDGET_MS = 6500;

/** @type {'named'|'viewer'|'open'|'none'} */
let _accessType = 'none';
/** @type {(() => void)|null} */
let _resolveAccess = null;
/** @type {(() => void)|null} */
let _onGranted = null;
/** Runs on EVERY grant, where `_onGranted` runs once.
 *  @type {((scope?: string|null|false) => void)|null} — the argument is the PROVISIONAL SCOPE
 *  (v22.97): a member name = that member's own cached data; `null` = full grant; `false` = withdraw. */
let _onEveryGrant = null;
/** @type {(() => void)|null} */
let _resolveAuth = null;
/** In `open` mode, the un-awaited anonymous sign-in — held so `calendarAuthReady` can wait on the
 *  thing `calendarAccessReady` deliberately does not. @type {Promise<any>|null} */
let _anonSettled = null;

/** Resolves the FIRST time Calendar access is granted, and never rejects.
 *  Never-rejecting is deliberate: every consumer uses it as a gate, and a rejection would have each
 *  of them needing its own catch — one missed catch would then be an unhandled rejection on the
 *  app's start page. Access that is never granted simply never resolves, and the locked UI is the
 *  user-visible half of that. */
export const calendarAccessReady = /** @type {Promise<void>} */ (new Promise(resolve => { _resolveAccess = () => resolve(); }));

/**
 * Resolves when this browser holds a Firebase identity the app's best-effort WRITES can use.
 *
 * **Two promises, because v20.18 split what used to be one thing.** `calendarAccessReady` answers
 * "may this browser SEE the roster", and the whole point of that release was to stop it waiting on
 * a network round trip — the Calendar draws from a local roster and needs no identity to do it.
 * But the error reporter, the usage counters, the latency sampler, the document-open counters and
 * the push-subscription renewal all write to Firestore, and every one of those rules requires
 * `request.auth != null`.
 *
 * In `named` and `viewer` mode the two are the same instant: access is only granted once a real
 * user exists. In `open` mode they are NOT — the anonymous sign-in is deliberately left in flight
 * so the grid can paint — and a write issued in that window has no token. Anything that writes must
 * therefore await THIS, and anything that renders should await the other. Getting it backwards is
 * silent in both directions: a render that waits costs latency nobody attributes, and a write that
 * does not is simply rejected.
 *
 * Like its sibling it never rejects, and while the Calendar is locked it never resolves — a browser
 * that was never shown the roster has nothing worth recording.
 */
export const calendarAuthReady = /** @type {Promise<void>} */ (new Promise(resolve => { _resolveAuth = () => resolve(); }));

/** @returns {'named'|'viewer'|'open'|'none'} the access this browser currently holds.
 *  `open` means the staff PIN is switched OFF (`CONFIG.CALENDAR_PIN_ACCESS`) and the Calendar is
 *  running its pre-v20.12 model — anonymous session, no gate. See `initCalendarAccess`. */
export function getAccessType() { return _accessType; }

/** @returns {boolean} true when the Calendar is being viewed through the shared staff PIN. */
export function isViewerMode() { return _accessType === 'viewer'; }

// ── The decision ────────────────────────────────────────────────────────────────────────────────

/**
 * Resolve what access this browser has, tearing down anything stale first.
 *
 * `preserveCalendarViewer` is the one non-obvious argument. `reconcileExpiredIdentity` exists to
 * sign out a NON-ANONYMOUS Firebase identity that has outlived its local session (Finding #9) — and
 * the viewer is non-anonymous with no local session by construction, so the default behaviour would
 * sign it out on every single page load and the PIN would be required on every navigation. The flag
 * is scoped to this one caller: protected pages keep the default, so a viewer walking to Admin or
 * Settings is still torn down and cannot masquerade as a member.
 *
 * @returns {Promise<'named'|'viewer'|'none'>}
 */
async function resolveAccess() {
    // ── ONE BUDGET FOR THE WHOLE DECISION (v21.29, external latency review) ─────────────────────
    //
    // These used to be two SEQUENTIAL bounds — 6.5s for the reconcile, then a further 6s for the
    // restore — and because both were waiting on the same first auth emission, a wedged auth layer
    // could hold the access decision for ~12.5s while each of them waited out its own ceiling in
    // turn. Neither number was wrong; adding them was.
    //
    // Now the deadline belongs to the DECISION, and each step gets what is left of it. The worst
    // case is the budget, not the sum of its parts, and the normal path is unchanged: both steps
    // resolve promptly and nothing waits at all.
    const started   = Date.now();
    const remaining = () => Math.max(0, ACCESS_DECISION_BUDGET_MS - (Date.now() - started));
    try {
        // The race leaves reconcile running in the background if it is merely slow: it is an
        // idempotent teardown, and the decision below reads ground truth either way.
        await Promise.race([
            reconcileExpiredIdentity({ preserveCalendarViewer: true }),
            new Promise(resolve => setTimeout(resolve, remaining())),
        ]);
    } catch { /* best effort — the decision below is made from ground truth either way */ }
    // `auth.currentUser` alone MISSES a cold restore: persistence being configured does not mean the
    // persisted user has loaded, and the boot restore is what delivers it. Reading too early would
    // report `none` for a member who is signed in and put the PIN in front of them — the exact
    // "distracting flash" this has to avoid. `currentUserAfterBoot` is the SHARED wait on that one
    // restore (firebase-client.js), so this no longer opens a third subscription of its own.
    const user = await currentUserAfterBoot(remaining());
    return decideAccess({ session: getSession(), firebaseUser: user });
}

/**
 * Keep watching after the decision, and GRANT the moment a named identity turns up.
 *
 * ── THE DECISION WAS MADE ONCE, AND THAT WAS THE BUG ────────────────────────────────────────────
 *
 * `resolveAccess` gives the restore a bounded wait — it has to, or a wedged auth layer holds the
 * Calendar at a blank screen for ever. But the bound was a CLIFF: a restore landing a millisecond
 * late was ignored for the rest of the page load, so a signed-in member sat in front of the staff
 * PIN with no recovery but a reload. Reproduced in a browser: with the identity arriving at 14s,
 * the body was still `calendar-locked` six seconds later.
 *
 * This turns the cliff into a window. The bound still decides what to SHOW promptly; a late
 * identity now simply corrects it. Nothing about the security model changes — a grant still
 * requires exactly what `decideAccess` required — and the listener is dropped the moment it fires
 * or the Calendar is granted access by any other route.
 *
 * Deliberately NOT time-limited. There is no instant after which a member's own restored identity
 * should stop being honoured, and the listener costs one closure.
 */
function watchForLateNamedIdentity() {
    let off = /** @type {null | (() => void)} */ (null);
    const stop = () => { if (off) { try { off(); } catch { /* noop */ } off = null; } };
    try {
        off = onAuthStateChanged(auth, (/** @type {any} */ u) => {
            // Only ever UPGRADES, and only from locked. A grant that already happened owns the
            // page; re-granting would run the workspace hooks a second time.
            if (_accessType !== 'none') { stop(); return; }
            if (decideAccess({ session: getSession(), firebaseUser: u }) !== 'named') return;
            stop();
            console.warn('[CalendarAccess] a named identity restored after the access decision — granting.');
            grant('named');
        }, () => stop());
    } catch { /* an auth layer that cannot be watched simply leaves the panel up */ }
    return stop;
}

// ── THE PROVISIONAL PAINT (v22.97) ──────────────────────────────────────────────────────────────
//
// The owner decision of 5 Sep 2026. What it permits and what it refuses is argued once, in
// `calendar-access-core.js` → `decideProvisionalAccess`; this is the wiring.
//
// **IT IS NOT AN ACCESS TYPE, AND THAT IS DELIBERATE.** `_accessType` stays `'none'` throughout, so
// every one of the eight places that read it is right as written — the late-identity watcher keeps
// watching, `handleAccessLost` has nothing to re-lock, and `getAccessType()` does not tell a caller
// this member has access, because they do not yet. Provisional is a PAINT, not a grant.
//
// Two things it deliberately does NOT do, and both are what keep it narrow:
//   · it does not resolve `calendarAccessReady`. Phase 2 of the initial fetch waits on that promise
//     — so the authoritative read, the one-time notices and everything else gated on it simply do
//     not run yet. Nothing is fetched under an unconfirmed identity, and it costs no new code path.
//   · it does not resolve the WRITE gate. A member may look at what they already had; they may not
//     record anything until Firebase has said who they are.
// Deliberately NOT exported. It was, briefly, and nothing consumed it: every consumer already
// learns the scope from `onEveryGrant`'s argument, which is the one place it can be acted on. An
// exported reader here would be a second way to ask a question that is not `getAccessType()`'s, on
// the module where confusing the two is most expensive.
/** @type {string|null} the member a provisional paint is up for, or null. */
let _provisionalFor = null;

/** Paint this member's own cached roster while their stored identity is revalidated. */
function grantProvisional(/** @type {string} */ member) {
    _provisionalFor = member;
    document.body.classList.remove('calendar-locked');
    document.body.classList.add('calendar-unlocked');
    hideLockPanel();               // owns the skeleton timer — see initCalendarAccess
    setWorkspaceHidden(false);
    // The SCOPE travels with the grant: the coordinator's wrapper passes it to
    // `setOverrideAccess`, which puts the `memberName` filter in the cached query itself.
    if (_onEveryGrant) { try { _onEveryGrant(member); } catch (e) { console.error('[CalendarAccess] provisional gate failed', e); } }
    if (_onGranted) { const fn = _onGranted; _onGranted = null; try { fn(); } catch (e) { console.error('[CalendarAccess] provisional start failed', e); } }
}

/**
 * Take it back, because the identity did not confirm.
 *
 * **A MEMBER IS NEVER SENT TO THE STAFF PIN** — `CALENDAR_DATA.md` invariant 11 — so this does not
 * call `handleAccessLost`, whose message asks for the PIN. This is somebody whose own stored
 * session did not revalidate, and the honest next step is their own sign-in, which the caller shows
 * by falling through to the ordinary `none` handling.
 *
 * The gate is shut FIRST and the workspace hidden immediately: between those two, a render must not
 * be able to repaint from the cache we are in the middle of withdrawing.
 */
function revokeProvisional() {
    if (!_provisionalFor) return;
    _provisionalFor = null;
    if (_onEveryGrant) { try { _onEveryGrant(false); } catch (e) { console.error('[CalendarAccess] provisional revoke failed', e); } }
    setWorkspaceHidden(true);
    document.body.classList.remove('calendar-unlocked');
    document.body.classList.add('calendar-locked');
}

/** Commit an access decision exactly once, and let the Calendar start. */
function grant(/** @type {'named'|'viewer'|'open'} */ type) {
    _accessType = type;
    // A fresh session starts with a clean slate on the CLIENT backoff too. Without this, a member
    // who fumbled three times at boot, unlocked, and is re-locked hours later (PIN rotation) begins
    // their next attempt already one failure from the delay — punished for a mistake from a
    // different sitting. The server's window is authoritative and is not touched by this.
    resetUnlockFailures();
    document.body.classList.remove('calendar-locked');
    document.body.classList.add('calendar-unlocked');
    hideLockPanel();
    setWorkspaceHidden(false);
    // TWO hooks, because a grant is two different things (v20.41). Building the workspace must happen
    // ONCE — running it twice would re-wire the swipe handler and re-launch the initial fetch. But
    // REOPENING the override gate must happen EVERY time, and bundling the two into one one-shot
    // callback was a real dead end: after `handleAccessLost` re-locked, a viewer who entered the new
    // PIN got the workspace back with `_accessGranted` still false, so every read was refused at
    // source and every month sat on "Checking this month" for ever. That is not a corner — revoking
    // the viewer's tokens is a documented step of rotating the PIN, so it is the NORMAL path, and it
    // is the one place the user has already done everything right.
    // Clears any provisional scope: `_onEveryGrant(null)` re-opens the gate UNSCOPED, so a member
    // whose identity just confirmed stops being confined to their own row.
    _provisionalFor = null;
    if (_onEveryGrant) { try { _onEveryGrant(null); } catch (e) { console.error('[CalendarAccess] gate reopen failed', e); } }
    if (_onGranted) { const fn = _onGranted; _onGranted = null; try { fn(); } catch (e) { console.error('[CalendarAccess] start failed', e); } }
    if (_resolveAccess) { const r = _resolveAccess; _resolveAccess = null; r(); }
    // The WRITE gate. `named`/`viewer` already hold a user, so it is the same instant; `open` has a
    // sign-in still in flight, so it waits for that to SETTLE — settle, not succeed, because a
    // failed anonymous sign-in must let the writes attempt and fail rather than hang for ever.
    if (_resolveAuth) {
        const r = _resolveAuth; _resolveAuth = null;
        if (type === 'open' && _anonSettled) _anonSettled.then(r, r);
        else r();
    }
}

// ── The unlock exchange ─────────────────────────────────────────────────────────────────────────

/**
 * Trade a PIN for a viewer session.
 *
 * The PIN is a parameter and a request body and nothing else — it is never assigned to module
 * state, never stored, and never included in a thrown error or a console line. The `finally` is not
 * decoration: an exception mid-flight would otherwise leave the last attempt sitting in a closure
 * that the error's stack keeps alive.
 *
 * @param {string} pin
 * @returns {Promise<{ ok: true }|{ ok: false, kind: string, message: string }>}
 */
export async function unlockWithPin(pin) {
    if (!isCompletePin(pin)) {
        return { ok: false, kind: 'rejected', message: `Enter the ${PIN_LENGTH}-digit staff PIN.` };
    }
    // A member signed in WHILE this card was on screen — through "Sign in instead", or in another
    // tab. Unlocking now would sign that member out (the ladder below starts by clearing whoever is
    // current) and replace a real identity with a shared capability. Reload instead: the boot
    // decision then answers `named`, which is the outcome they were reaching for anyway.
    if (getSession()?.name && auth.currentUser && !isViewerUser(auth.currentUser)) {
        window.location.reload();
        return { ok: true };
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        const f = classifyUnlockFailure({ offline: true });
        return { ok: false, kind: f.kind, message: f.message };
    }

    /** @type {Response} */
    let res;
    try {
        const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
        const timer = setTimeout(() => { try { ctrl?.abort(); } catch { /* noop */ } }, UNLOCK_TIMEOUT_MS);
        try {
            res = await fetch(UNLOCK_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pin }),
                cache: 'no-store',
                signal: ctrl ? ctrl.signal : undefined,
            });
        } finally { clearTimeout(timer); }
    } catch {
        // A thrown fetch is a transport failure — there is no status to classify, and deliberately
        // no retry here: the member is standing at the panel and pressing the button again IS the
        // retry, with the state visible to them rather than happening silently.
        const f = classifyUnlockFailure({ status: null });
        return { ok: false, kind: f.kind, message: f.message };
    }

    if (!res.ok) {
        const f = classifyUnlockFailure({ status: res.status });
        return { ok: false, kind: f.kind, message: f.message };
    }

    /** @type {any} */
    let data;
    try { data = await res.json(); } catch { data = null; }
    const token = data && typeof data.token === 'string' ? data.token : null;
    if (!token) {
        const f = classifyUnlockFailure({ status: 500 });
        return { ok: false, kind: f.kind, message: f.message };
    }

    try {
        // ── The persistence switch, in the one order that is safe ───────────────────────────────
        // Sign out anything already here FIRST. `setPersistence` migrates the CURRENT user into the
        // new persistence, so setting session-only while some other identity is live would demote
        // that identity instead of preparing for ours. There should be nobody here (we are locked),
        // but "should be" is not a guarantee worth betting the boundary on.
        //
        // **And a failed sign-out ABORTS — it used to be swallowed (v20.35).** The `catch {}` here
        // said "best effort", which meant the very next line changed persistence with an unexpected
        // identity still live: the exact move the paragraph above and the module header both say
        // must never happen. It is the mirror of the fail-open in `shedCalendarViewer`, found in
        // the same review. Refusing to unlock is the safe failure — the member sees the PIN card
        // again and retries, and no identity has been moved between persistence modes.
        if (auth.currentUser) {
            try {
                await signOut(auth);
            } catch (err) {
                console.warn('[CalendarAccess] could not clear the existing identity; not switching persistence:',
                    /** @type {any} */ (err)?.message);
                const f = classifyUnlockFailure({ code: 'signout-failed' });
                return { ok: false, kind: f.kind, message: f.message };
            }
            // Assert the state rather than trust the call — the invariant is that nobody is current
            // when persistence changes, not merely that signOut resolved.
            if (auth.currentUser) {
                console.warn('[CalendarAccess] identity survived sign-out; not switching persistence');
                const f = classifyUnlockFailure({ code: 'signout-failed' });
                return { ok: false, kind: f.kind, message: f.message };
            }
        }
        await setViewerPersistence();
        const cred = await signInWithCustomToken(auth, token);

        // VERIFY WHAT WE ACTUALLY GOT — never assume the server sent what we asked for. A token
        // without the claim would sail through sign-in and then have every override read denied,
        // leaving a Calendar that looks unlocked and shows nothing. Better to stay locked.
        const res2 = await cred.user.getIdTokenResult();
        if (res2?.claims?.[CALENDAR_VIEWER_CLAIM] !== true || !isViewerUser(cred.user)) {
            try { await signOut(auth); } catch { /* noop */ }
            const f = classifyUnlockFailure({ code: 'missing-claim' });
            return { ok: false, kind: f.kind, message: f.message };
        }
        grant('viewer');
        return { ok: true };
    } catch (e) {
        // The PIN was accepted and sign-in still failed. Leave NO half-authenticated state behind.
        try { await signOut(auth); } catch { /* noop */ }
        const f = classifyUnlockFailure({ code: /** @type {any} */ (e)?.code || 'auth-failed' });
        return { ok: false, kind: f.kind, message: f.message };
    }
}

/**
 * Drop the viewer session and return the Calendar to its locked state — the nav drawer's
 * "Lock Calendar". Only ever offered in viewer mode, so it can never touch a member's session.
 * Reloads rather than tearing the Calendar down in place: the page has already rendered a member's
 * shifts, and unwinding that by hand is a long list of things to remember, every one of which
 * leaves roster data on screen if it is forgotten.
 * @returns {Promise<void>}
 */
export async function lockCalendar() {
    if (_accessType !== 'viewer') return;
    // FAIL CLOSED, BECAUSE THE ALTERNATIVE IS A CONTROL THAT LIES (v20.39, audit §13).
    // This used to swallow a failed sign-out and reload anyway, on the reasoning that the reload
    // re-decides from ground truth. It does — and if the sign-out did not take, that ground truth is
    // "still a viewer", so the Calendar comes back UNLOCKED. Somebody walks away from a shared
    // machine having pressed Lock and watched the page reload. A button that reports success it did
    // not achieve is worse than one that fails visibly.
    await signOut(auth);
    if (isViewerUser(auth.currentUser)) {
        throw new Error('viewer still current after sign-out — Calendar not locked');
    }
    // Back to the PIN card, not the sign-in card: whoever pressed Lock got in with the PIN, so this
    // is a machine the PIN is used on, and the next person is most likely to want the same route.
    window.location.replace('./' + PIN_FIRST_HASH);
}

// ── The workspace gate ──────────────────────────────────────────────────────────────────────────

/** The Calendar workspace: everything that implies usable roster data. The header and the nav
 *  drawer are deliberately NOT in this list — the guides are reachable without Calendar access, and
 *  locking the whole app to read the Railcard guide would be absurd. The Huddle and the documents
 *  used to be reachable too; since v23.17 their reads sit behind `calendar-doc-access.js`, which
 *  `calendar-app.js` opens on the full grant — so the drawer still SHOWS them, and a tap while
 *  locked is answered with what to do rather than with the document. */
const WORKSPACE_IDS = ['calendarControls', 'installPrompt', 'notifPrompt', 'payPeriodStrip', 'swipeHint', 'calendarDisplay', 'calendarLegend'];

/** @param {boolean} hidden */
function setWorkspaceHidden(hidden) {
    for (const id of WORKSPACE_IDS) {
        const el = document.getElementById(id);
        if (!el) continue;
        // The `hidden` ATTRIBUTE, not a CSS class or opacity: it removes the element from the
        // accessibility tree as well as the page, so a screen reader cannot read out a Calendar the
        // eye cannot see. There is nothing inside these nodes to hide while locked — the Calendar is
        // never initialised — but a gate whose correctness depends on something else being empty is
        // one refactor away from not being a gate.
        if (hidden) el.setAttribute('hidden', '');
        else el.removeAttribute('hidden');
    }
}

// ── The cards ───────────────────────────────────────────────────────────────────────────────────
//
// Wired at module scope, so a card can never be shown before its collaborators exist. All four are
// function declarations or an exported function in this file, so hoisting makes this safe here.
initLockCards({ unlockWithPin, getAccessType, setWorkspaceHidden, unlockUrl: UNLOCK_URL });

/** How long the decision may take before the page has to say something. Long enough that a normal
 *  boot — where access resolves in the same tick the workspace would have rendered — never flashes
 *  it, short enough that nobody stares at nothing. */
const SKELETON_AFTER_MS = 400;

/** How long the member's silent re-establishment may keep the skeleton up before the sign-in card
 *  goes up anyway (v21.62 — see the boot path). The bound exists for the HANGING attempt, not the
 *  failing one: a wrong-password rejection resolves in well under a second and shows the card at
 *  once, so this only decides how long a stalled network holds the skeleton over a card the member
 *  will probably need. Shorter than `trySilentReauth`'s own 8s ceiling on purpose — the attempt
 *  keeps running behind the card and a late success still grants. */
const SILENT_BEFORE_CARD_MS = 4000;


/**
 * Re-establish the member's own Firebase identity with nothing typed, if that is possible.
 *
 * `ensureNamedSession` with no password tries ONLY the derived surname (PASSWORD_DESIGN.md §3.4), which
 * is what makes this safe to fire unprompted: for a member still on the default it restores the exact
 * identity they already had, and for a migrated member it fails cleanly against a password nobody
 * chose. It is the same page-load re-establishment every other coordinator already performs — the
 * Calendar simply never had a reason to until access depended on it.
 *
 * The RESULT is read from `decideAccess`, never from the boolean. `ensureNamedSession` returns true
 * for an anonymous fallback when `ENFORCE_NAMED_SESSION` is off, and an anonymous identity must never
 * be granted `named` access here — that is the whole substance of v20.12.
 *
 * @param {string} name
 * @returns {Promise<boolean>}
 */
async function trySilentReauth(name) {
    try {
        // Bounded, like every other wait on this path. Timing out does not cancel the sign-in — it
        // just stops the button pretending to work; a late success is picked up by the watcher.
        await Promise.race([
            ensureNamedSession(name),
            new Promise(resolve => setTimeout(resolve, 8000)),
        ]);
    } catch { /* a failed re-auth is the expected outcome for a migrated member */ }
    try {
        return decideAccess({ session: getSession(), firebaseUser: auth.currentUser }) === 'named';
    } catch { return false; }
}

/**
 * Re-lock a Calendar whose access has gone while it was open, and say why.
 *
 * Called by the sync chip when a read fails with `permission-denied` — which means the session
 * expired or was revoked, NOT that the network is poor. Those two need different words: an endless
 * "couldn't update, tap to retry" against an expired session is a loop the member cannot win, and
 * they would reasonably conclude the app is broken.
 */
export function handleAccessLost() {
    if (_accessType === 'none') return;
    // Nothing to return TO when the PIN is switched off: there is no lock card, and showing one
    // would strand a member behind a control the deployment has deliberately disabled.
    if (_accessType === 'open') return;
    // The CALLER closes the override gate (calendar-app.js passes a wrapper that calls
    // `setOverrideAccess(false)` first). It is not done here because this module deliberately does
    // not import calendar-overrides.js — the gate must not depend on the access layer it protects
    // against — but it MUST happen, or a re-lock would leave the local-cache read open and the next
    // month navigation could paint yesterday's roster behind the unlock card.
    const wasNamed = _accessType === 'named';
    _accessType = 'none';
    document.body.classList.remove('calendar-unlocked');
    // The way back in is the way they came in. A MEMBER whose session has gone gets their own
    // card, never the PIN (CALENDAR_DATA.md 11 — this path sent everyone to the PIN card until
    // v23.19); a viewer gets the PIN card with the reason written into its message channel.
    if (wasNamed) {
        const why = 'Calendar access has expired. Sign in again to carry on.';
        const held = getSession();
        if (held?.name) showMemberPanel(held.name, why);
        else showSignInPanel(why).catch(() => {});   // the session itself has gone: the front door, with the reason on it
        return;
    }
    showLockPanel();
    const msg = document.getElementById('calLockMsg');
    if (msg) {
        msg.classList.add('visible', 'cal-lock-msg--info');   // visible BEFORE the text — see say()
        msg.textContent = 'Calendar access has expired. Enter the staff PIN to carry on.';
    }
}

// ── Boot ────────────────────────────────────────────────────────────────────────────────────────

/**
 * Decide access and either start the Calendar or show the unlock panel.
 *
 * @param {{ onGranted: () => void, onEveryGrant?: ((scope?: string|null|false) => void)|null }} deps
 *   onGranted runs ONCE, the first time access is granted. It is how `calendar-app.js` defers every
 *   piece of Calendar initialisation — the member dropdown, the render, the fetch, the swipe handler
 *   — so that none of it exists while locked. Running it twice would duplicate all of that.
 *   onEveryGrant runs on EVERY grant, including one that follows a re-lock. Anything that a re-lock
 *   TURNS OFF has to be turned back on here rather than in `onGranted`, or it stays off for the rest
 *   of the session — see the note in `grant`.
 * @returns {Promise<'named'|'viewer'|'open'|'none'>}
 */
export async function initCalendarAccess({ onGranted, onEveryGrant = null }) {
    _onGranted = onGranted;
    _onEveryGrant = onEveryGrant;
    // Hide the workspace SYNCHRONOUSLY, before any await. The decision below is asynchronous, and
    // between here and there the browser paints — so leaving the workspace visible would flash an
    // empty Calendar shell at a member who is about to be shown their roster, and worse, would show
    // it to somebody who is about to be shown the PIN.
    setWorkspaceHidden(true);
    document.body.classList.add('calendar-locked');

    // `#staff-pin` is read ONCE and removed whatever the decision: a member with a session who opened
    // a station PC's bookmark must not carry it into their own Calendar (v23.19's locked-path-only
    // consumption let them).
    const pinFirst = window.location.hash === PIN_FIRST_HASH;
    if (pinFirst) {
        try { history.replaceState(history.state, '', window.location.pathname + window.location.search); } catch { /* noop */ }
    }

    // Say something if the decision is slow (v20.80). Scheduled BEFORE the await, cleared by every
    // path out of it — `grant()` and both cards call `hideLockPanel()`, which owns the timer.
    armSkeleton(SKELETON_AFTER_MS);

    // ── THE FAST PATH (v22.97) ──────────────────────────────────────────────────────────────────
    //
    // Taken BEFORE the await, which is the whole point: `resolveAccess` waits on
    // `currentUserAfterBoot`, and that wait is the `accounts:lookup` round trip the September field
    // read shows at over a second on 60% of Calendar opens.
    //
    // Not under the PIN-off rollback: that mode signs everyone in anonymously and grants access to
    // all of it anyway, so a provisional paint would add a second path to the same screen.
    //
    // The two preconditions beyond the session are READ here and argued in the decision. They come
    // from storage rather than from `calendar-member.js`, which has not been asked anything yet.
    const _prov = CONFIG.CALENDAR_PIN_ACCESS === false
        ? { decision: 'none', member: null }
        : decideProvisionalAccess({
            session: getSession(),
            teamView: lsGet(TEAM_VIEW) === '1',
            selectedMember: lsGet(SELECTED_MEMBER),
        });
    if (_prov.decision === 'own-cached' && _prov.member) grantProvisional(_prov.member);

    /** @type {'named'|'viewer'|'open'|'none'} */
    let type;
    try { type = await resolveAccess(); }
    catch (e) { console.error('[CalendarAccess] decision failed', e); type = 'none'; }

    // The identity did not confirm, so the paint goes back. `grant()` clears it on the other
    // branch; here nothing else would, and leaving it up is the one outcome this must not have.
    if (_provisionalFor && type !== 'named') revokeProvisional();

    // ── THE SWITCH (v20.16) ─────────────────────────────────────────────────────────────────────
    //
    // `CONFIG.CALENDAR_PIN_ACCESS: false` puts the Calendar back on its pre-v20.12 model: an
    // anonymous session, no gate, no card, exactly what staff had before. It exists so the whole
    // feature can be deployed DARK — shipped, running, and invisible — and switched on later by a
    // one-line change, and so it can be switched off again in seconds if the exchange misbehaves in
    // production. Both directions are a hosting deploy; neither touches the rules.
    //
    // **It controls FRICTION, NOT PROTECTION, and confusing the two is the way to get hurt here.**
    // Override reads are the server's decision. While `firestore.rules` still carries the old
    // permissive `allow read;`, this flag is the only thing standing between a visitor and the
    // roster — so "off" genuinely means open to anyone with the URL, as it always was. Once the
    // rules are tightened, turning this off no longer re-opens anything: the reads are denied by the
    // server and the anonymous session below satisfies nothing. Off is a rollback for the WINDOW
    // between the two deploys, not afterwards.
    //
    // It resolves the access type normally first, so a signed-in member is still `named` and every
    // member-specific behaviour is unchanged. Only the FALLBACK moves: `none` (locked) becomes
    // `open` (anonymous, running).
    if (CONFIG.CALENDAR_PIN_ACCESS === false) {
        if (type === 'none') {
            // The pre-v20.12 bootstrap, restored for this mode. The calendar's best-effort WRITES —
            // the error reporter, the usage counters, the push-subscription renewal — all require
            // `request.auth != null`, so without this they would silently stop and the app would
            // look fine while going quiet on exactly the telemetry that would tell you it had.
            //
            // **STARTED, NOT AWAITED — and that is a latency property, not a style choice.**
            // `signInAnonymously` is a network POST to identitytoolkit. Awaiting it here put a full
            // round trip in front of the FIRST PAINT of the grid: hundreds of milliseconds of blank
            // splash on a station phone, seconds on a bad signal, and on no signal at all the
            // calendar would not render until the request gave up — a device holding a complete
            // offline roster showing nothing. The pre-v20.12 code never awaited it either; it was
            // introduced by this switch and is the one thing here that is pure cost.
            //
            // Nothing downstream needs it: rendering reads the local roster module, override reads
            // are gated separately, and every write that needs a session already awaits its own
            // promise. The `.catch` is what "best effort" means — a failed anonymous sign-in must
            // not reject an unhandled promise, and it must not stop the Calendar.
            try { _anonSettled = Promise.resolve(signInAnonymously(auth)).catch(() => {}); }
            catch { _anonSettled = Promise.resolve(); }
            type = 'open';
        }
        console.warn('[CalendarAccess] staff PIN is switched OFF (CONFIG.CALENDAR_PIN_ACCESS)');
    }

    if (type === 'named' || type === 'viewer' || type === 'open') { grant(type); return type; }

    // Locked. Two things happen before the card goes up, and both exist because the decision above
    // is a SNAPSHOT of a restore that is not always finished (v20.79).
    //
    //   · Keep listening. A named identity that lands after the bound now grants instead of being
    //     ignored until the member thinks to reload.
    //   · Ask WHO. A browser holding a live local session is not an unknown visitor at a shared PC;
    //     it is a member whose identity has gone, and the answer for them is their own sign-in, not
    //     a shared code. See `showMemberPanel`.
    watchForLateNamedIdentity();
    const held = getSession();
    if (!held?.name) {
        // Nothing held: the front door. Sign-in first (owner decision, v23.19); the PIN card first
        // ONLY when asked for by the hash — a "Use the staff PIN instead" sign-out, or a station
        // PC's bookmark (consumed above).
        if (pinFirst) showLockPanel();
        else await showSignInPanel();
        return 'none';
    }

    // ── THE SILENT ATTEMPT RUNS BEHIND THE SKELETON, NOT BEHIND A SIGN-IN CARD (v21.62) ────────
    //
    // It used to run behind the member card's disabled "Signing you in…" state — so every member
    // whose identity restore merely missed the boot budget SAW A SIGN-IN SCREEN, even on the loads
    // that recovered themselves moments later. The first live month of the start ladder showed 56%
    // of Calendar opens taking over a second just to restore the identity (LATENCY.md → First
    // reading), which made that flash a routine experience rather than an edge case — and it is
    // what staff meant by "the app keeps asking for my password". Behind the skeleton, the loads
    // that recover (a slow restore, a surname-default member) never show a sign-in surface at all.
    //
    // The card is DEFERRED, not withheld: it appears the moment silence definitively fails (a
    // wrong-password rejection returns in well under a second — and instantly for a member this
    // device already knows is migrated, see session.js `_noDefaultKey`), or at the defer bound if
    // the attempt is merely hanging — whichever is first. And when it appears it is immediately
    // actionable, because the waiting it used to represent has already happened.
    // Put the skeleton up NOW unless it already is — the timer may not have fired when the decision
    // was quick, and whatever else the slot might hold is stale for this boot. `showBootSkeleton`
    // replaces rather than stacks, and its `hideLockPanel` disarms the pending timer.
    if (lockCardId() !== 'calendarBooting') showBootSkeleton();
    const silent = trySilentReauth(held.name);
    /** @type {any} */ let deferTimer = null;
    // ── THE WAIT MAY NOT BE ABLE TO STRAND THE MEMBER (v21.63, self-review) ─────────────────────
    //
    // Before v21.62 the silent attempt was DETACHED — `showMemberPanel` fired it and returned — so
    // nothing it did could stop the card appearing. Moving it onto the await path to hide the flash
    // gave away that property: `trySilentReauth` catches everything today, so this cannot reject in
    // practice, but if a later edit let one through, `initCalendarAccess` would reject, no card
    // would be built, and the member would sit on the skeleton until `splash-watchdog` fired at 20s.
    // Restored by catching here rather than by trusting a function three screens away to keep a
    // promise it never advertised. `false` is the safe answer: it shows the sign-in card, which is
    // the recoverable state.
    const ok = await Promise.race([
        // `finally` clears the defer timer whenever the attempt settles — before the bound (the
        // normal case, where the pending timer would otherwise just linger) or after it (harmless:
        // resolving a settled promise is a no-op).
        silent.finally(() => { if (deferTimer) { clearTimeout(deferTimer); deferTimer = null; } }),
        new Promise(resolve => { deferTimer = setTimeout(() => resolve(null), SILENT_BEFORE_CARD_MS); }),
    ]).catch(() => false);
    // The late-identity watcher may have granted while we waited — granting twice is not harmless
    // (`_onEveryGrant` rebuilds the override gate), so whichever route arrives second stands down.
    if (_accessType !== 'none') return _accessType;
    if (ok) { grant('named'); return 'named'; }
    showMemberPanel(held.name);
    // `null` means the attempt is still in flight past the defer bound. A late success is still a
    // success: honour it exactly the way the watcher honours a late restore.
    if (ok === null) silent.then(late => { if (late && _accessType === 'none') grant('named'); });
    return 'none';
}
