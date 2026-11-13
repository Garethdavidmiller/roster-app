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
 *   Nor the ANSWER once decided: whether access is held is kept ONCE, in calendar-access-state.js,
 *   which this module WRITES (`grant`, `handleAccessLost`) and the two gates read (v25.74).
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
 * screen before access is granted. The PIN card comes first only when asked (`takePinFirst`, read
 * once at boot): `#staff-pin`, which a "Use the staff PIN instead" sign-out reloads with and a
 * station PC can bookmark, or the one-tab mark left by a page in this tab that ended the PIN.
 *
 * The cards share ONE slot (`calendar-lock-slot.js`) so at most one of them can exist at a time.
 */

import { auth, signInWithCustomToken, signOut, setViewerPersistence, onAuthStateChanged, currentUserAfterBoot, authBootstrap } from './firebase-client.js';
import { getSession, reconcileExpiredIdentity, ensureNamedSession, authGeneration, ACCESS_DECISION_BUDGET_MS } from './session.js';
import { fetchWithTimeout } from './fetch-timeout.js';
import { isViewerUser, decideAccess, isCompletePin, classifyUnlockFailure, PIN_LENGTH, CALENDAR_VIEWER_CLAIM } from './calendar-access-core.js';
import { lockCardId, armSkeleton, showBootSkeleton } from './calendar-lock-slot.js';
// The three cards this gate can put where the Calendar goes. They DRAW; this file DECIDES —
// the split is along the line this module's own header already stated. `initLockCards` below
// hands them the four collaborators they cannot import back without a cycle.
import { initLockCards, resetUnlockFailures, hideLockPanel, showLockPanel, showSignInPanel,
         showMemberPanel, dismissSignInForm, takePinFirst, PIN_FIRST_HASH } from './calendar-lock-cards.js';
import { hasCalendarAccess, setCalendarAccess } from './calendar-access-state.js';

/** The exchange endpoint. Same region + project as every other MYB function. */
const UNLOCK_URL = 'https://europe-west2-myb-roster.cloudfunctions.net/unlockCalendarViewer';

/** How long to wait on the exchange before calling it a network failure. Generous — a cold start of
 *  a rarely-called function is a real several seconds — and ABOVE the endpoint's own 20s ceiling
 *  (`timeoutSeconds`, functions/index.js; fetch-timeout.js): a client that gives up first calls a
 *  working server broken. It was 15s until v25.77. */
const UNLOCK_TIMEOUT_MS = 25000;

/** How long an unlock waits for the boot's persistence choice (`unlockWithPin`), and the wait. */
const BOOT_SETTLE_FOR_UNLOCK_MS = 20000;
function bootSettledWithin(/** @type {number} */ ms) {
    /** @type {any} */ let timer;
    const late = new Promise(r => { timer = setTimeout(() => r(false), ms); });
    return Promise.race([authBootstrap.then(() => true), late]).finally(() => clearTimeout(timer));
}

// ACCESS_DECISION_BUDGET_MS — session.js's since v24.96, one constant for this decision and
// holdsStaffPin's — is the WHOLE decision's deadline, not a per-step one (v21.29): everything
// `resolveAccess` waits for shares it, so a wedged auth layer costs it once. Past it the answer is
// `none`, a card, which is recoverable — and the late-identity watcher corrects it when an identity lands.

/**
 * WHICH access the grant in force is: the kind, and only the kind.
 *
 * Whether access is HELD is not kept here. That is `hasCalendarAccess()`, the one copy the roster
 * and document gates read too (calendar-access-state.js), so this module cannot report `named` or
 * `viewer` over gates that have shut: `getAccessType` asks the state every time. A `'none'` never
 * goes in this variable: it would be a second copy of that fact.
 *
 * Null until the first grant, and again once this module has put a lock card up for an access that
 * has gone. That second null is what `handleAccessLost` goes by. A refused month read shuts the
 * state BEFORE it calls here (calendar-overrides.js), so by then the state can no longer say which
 * card is owed — the member's own, or the PIN — or whether one is already up.
 * @type {'named'|'viewer'|null}
 */
let _grantedAs = null;
/** @type {(() => void)|null} */
let _resolveAccess = null;
/** @type {(() => void)|null} */
let _onGranted = null;
/** Runs on EVERY grant, where `_onGranted` runs once. @type {(() => void)|null} */
let _onEveryGrant = null;
/** Told when a lock card that needs somebody to type is up (calendar-app.js → the speed recorder,
 *  which this module does not import). @type {(() => void)|null} */
let _onAwaitingInput = null;
/** @type {(() => void)|null} */
let _resolveAuth = null;

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
 * Today the two are the same instant: access is only ever granted (`named` or `viewer`) once a real
 * user exists. They were not while a third mode existed — `open`, the anonymous no-PIN Calendar of
 * the `CALENDAR_PIN_ACCESS` switch (retired v24.34), which left its sign-in in flight so the
 * grid could paint. The split is kept because the contract is still the right one: anything that
 * writes awaits THIS, and anything that renders awaits the other. Getting it backwards is silent in
 * both directions: a render that waits costs latency nobody attributes, and a write that does not
 * is simply rejected.
 *
 * Like its sibling it never rejects, and while the Calendar is locked it never resolves — a browser
 * that was never shown the roster has nothing worth recording.
 */
export const calendarAuthReady = /** @type {Promise<void>} */ (new Promise(resolve => { _resolveAuth = () => resolve(); }));

/** @returns {'named'|'viewer'|'none'} the access this browser currently holds — `none` the moment
 *  the state shuts, by whichever route (see `_grantedAs`). */
export function getAccessType() { return _grantedAs !== null && hasCalendarAccess() ? _grantedAs : 'none'; }

/** @returns {boolean} true when the Calendar is being viewed through the shared staff PIN. */
export function isViewerMode() { return getAccessType() === 'viewer'; }

// ── The decision ────────────────────────────────────────────────────────────────────────────────

/**
 * Resolve what access this browser has, tearing down anything stale first.
 *
 * `preserveCalendarViewer` is the one non-obvious argument. `reconcileExpiredIdentity` exists to
 * sign out a NON-ANONYMOUS Firebase identity that has outlived its local session (Finding #9) — and
 * the viewer is non-anonymous with no local session by construction, so the default behaviour would
 * sign it out on every single page load and the PIN would be required on every navigation. The flag
 * is scoped to the pages that admit the PIN — this one, and Trains through `holdsStaffPin` (v24.84):
 * other protected pages keep the default, so a viewer walking to Admin or Settings is still torn down
 * and cannot masquerade as a member.
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
    /** @type {ReturnType<typeof setTimeout>|undefined} */ let reconcileBound;
    try {
        // The race leaves reconcile running in the background if it is merely slow: it is an
        // idempotent teardown, and the decision below reads ground truth either way.
        await Promise.race([
            reconcileExpiredIdentity({ preserveCalendarViewer: true }),
            new Promise(resolve => { reconcileBound = setTimeout(resolve, remaining()); }),
        ]);
    } catch { /* best effort — the decision below is made from ground truth either way */ }
    finally {
        // Settled: the losing bound has nothing left to decide (test audit, 7 Nov 2026 — it ran on
        // for 6.5s after every prompt reconcile, holding this module's suite open).
        clearTimeout(reconcileBound);
    }
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
 *
 * A STAFF-PIN SESSION THAT RESTORES LATE IS HONOURED TOO (cal-data-10, 10 Nov 2026) — a station PC
 * reloading on a bad connection was shown the sign-in card for good, although the browser held a
 * valid PIN session the boot decision would have granted. It is granted as what `decideAccess` says
 * it is, the viewer, never as a member — and only once its token is seen to carry the claim, the
 * check the unlock itself makes; and never during the PIN card's own exchange, which checks the
 * claim and grants for itself (`_unlocking`). NOR while a member's session is held (sign-in check,
 * 11 Nov 2026): that member's own way back owns the page (CALENDAR_DATA.md 11).
 */
function watchForLateNamedIdentity() {
    const gen = authGeneration();   // a sign-in or sign-out begun after this owns the page (grantLateViewer)
    let off = /** @type {null | (() => void)} */ (null);
    const stop = () => { if (off) { try { off(); } catch { /* noop */ } off = null; } };
    try {
        off = onAuthStateChanged(auth, (/** @type {any} */ u) => {
            // Only ever UPGRADES, and only from locked. A grant that already happened owns the
            // page; re-granting would run the workspace hooks a second time.
            if (getAccessType() !== 'none') { stop(); return; }
            const late = decideAccess({ session: getSession(), firebaseUser: u });
            if (late === 'viewer') { grantLateViewer(u, stop, gen); return; }
            if (late !== 'named') return;
            stop();
            console.warn('[CalendarAccess] a named identity restored after the access decision — granting.');
            grant('named');
        }, () => stop());
    } catch { /* an auth layer that cannot be watched simply leaves the panel up */ }
    return stop;
}

/** True while the PIN card's exchange is signing in. It checks the claim and grants for itself, so a
 *  late viewer granted meanwhile — the exchange's own sign-in, or a restored session it is part-way
 *  through signing out — would be granted twice. */
let _unlocking = false;
/** A member's session is held — signed in while the PIN card was up, or its identity did not restore: the
 *  unlock reloads instead, so the boot offers them their own way in, never the PIN (audit F1). */
const memberSessionHeld = () => !!getSession()?.name;

/**
 * Grant a staff-PIN session that restored after the decision — see `watchForLateNamedIdentity`.
 * Asked again after the token read, because the page may have moved on while it was out.
 * NOR once a sign-in has begun since the watcher was armed (review, 11 Nov 2026): a typed one saves
 * its session only when it succeeds, so the session check alone granted the PIN underneath it.
 * @param {any} u the restored viewer @param {() => void} stop the watcher's own stop @param {number} gen
 */
async function grantLateViewer(u, stop, gen) {
    /** @type {any} */ let claims;
    try { claims = (await u.getIdTokenResult())?.claims; } catch { return; }
    if (claims?.[CALENDAR_VIEWER_CLAIM] !== true) return;
    // Granted meanwhile, or signed out by an exchange — or an exchange is still signing it out: the
    // SDK clears `currentUser` only when its own queue runs, so that one still reads as `u` here.
    if (_unlocking || getAccessType() !== 'none' || auth.currentUser !== u || getSession()?.name || authGeneration() !== gen) return;
    stop();
    console.warn('[CalendarAccess] a viewer session restored after the access decision — granting.');
    grant('viewer');
}

/** Commit an access decision exactly once, and let the Calendar start. */
function grant(/** @type {'named'|'viewer'} */ type) {
    // A fresh session starts with a clean slate on the CLIENT backoff too. Without this, a member
    // who fumbled three times at boot, unlocked, and is re-locked hours later (PIN rotation) begins
    // their next attempt already one failure from the delay — punished for a mistake from a
    // different sitting. The server's window is authoritative and is not touched by this.
    resetUnlockFailures();
    document.body.classList.remove('calendar-locked');
    document.body.classList.add('calendar-unlocked');
    hideLockPanel();
    dismissSignInForm();   // the come-back card's full-screen form is not in the slot (cal-data-9)
    setWorkspaceHidden(false);
    // ── THE ONE WRITE ───────────────────────────────────────────────────────────────────────────
    // The kind, and then the fact: from this line the roster reads and the documents are open
    // together, because both read the state this writes (calendar-access-state.js). Neither is
    // opened from a hook, where the two could be a line apart, or one forgotten.
    //
    // HERE, AND NOT A LINE EARLIER OR LATER. After the card has gone and the workspace is back: the
    // write tells the documents, and a document a locked tap was waiting for opens from inside it —
    // over the Calendar, not over a card about to be taken away. And BEFORE both hooks: the first
    // render's month read (`_onGranted`) and a re-unlock's repaint (`_onEveryGrant`) must find the
    // gate open and the old grant's month claims cleared. Against a shut gate the render claims
    // nothing, and the month sits on "Checking this month" for the session (v20.41: it shipped).
    _grantedAs = type;
    setCalendarAccess(true);
    // TWO hooks, because a grant is two different things (v20.41). Building the workspace must happen
    // ONCE — running it twice would re-wire the swipe handler and re-launch the initial fetch. But
    // what a re-lock takes away must come back on EVERY grant, and bundling the two into one
    // one-shot callback was a real dead end: after `handleAccessLost` re-locked, a viewer who entered
    // the new PIN got the workspace back with the roster reads still shut. That is not a corner —
    // revoking the viewer's tokens is a documented step of rotating the PIN, so it is the NORMAL
    // path, and it is the one place the user has already done everything right. The gates are the
    // write's to reopen (above), not this hook's; the repaint a re-unlock needs is the hook's.
    if (_onEveryGrant) { try { _onEveryGrant(); } catch (e) { console.error('[CalendarAccess] the every-grant hook failed', e); } }
    if (_onGranted) { const fn = _onGranted; _onGranted = null; try { fn(); } catch (e) { console.error('[CalendarAccess] start failed', e); } }
    if (_resolveAccess) { const r = _resolveAccess; _resolveAccess = null; r(); }
    // The WRITE gate. `named` and `viewer` both already hold a user, so it is the same instant.
    if (_resolveAuth) { const r = _resolveAuth; _resolveAuth = null; r(); }
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
 * @param {() => boolean} [stillWanted]  is the card that asked still on screen? (review, 11 Nov 2026)
 * @returns {Promise<{ ok: true }|{ ok: false, kind: string, message: string }>}
 */
export async function unlockWithPin(pin, stillWanted = () => true) {
    if (!isCompletePin(pin)) {
        return { ok: false, kind: 'rejected', message: `Enter the ${PIN_LENGTH}-digit staff PIN.` };
    }
    // A member's session is held (`memberSessionHeld`): the ladder below would sign them out for a shared
    // capability, or grant it over their session. Reload — the boot answers `named`, or offers their card.
    if (memberSessionHeld()) { window.location.reload(); return { ok: true }; }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        const f = classifyUnlockFailure({ offline: true });
        return { ok: false, kind: f.kind, message: f.message };
    }

    /** @type {Response} */
    let res;
    try {
        // fetchWithTimeout, not a hand-rolled abort: its deadline also covers reading the BODY
        // (`res.json()` below), which the old one cleared the moment the headers arrived.
        res = await fetchWithTimeout(UNLOCK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pin }),
            cache: 'no-store',
        }, UNLOCK_TIMEOUT_MS);
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

    // THE BOOT'S OWN PERSISTENCE CHOICE LANDS FIRST (sign-in check, 11 Nov 2026). On a start-up slow enough
    // that this card was used first, `authBootstrap`'s member chain landed AFTER the switch below and
    // MIGRATED the viewer into IndexedDB: the PIN outlived the browser (real SDK, both engines). A boot
    // that never settles fails closed: still locked, try again.
    if (!(await bootSettledWithin(BOOT_SETTLE_FOR_UNLOCK_MS))) {
        const f = classifyUnlockFailure({ code: 'boot-pending' });
        return { ok: false, kind: f.kind, message: f.message };
    }
    // A staff-PIN session restored late and was granted while this exchange was out (cal-data-10):
    // there is nothing left to unlock, and signing it out to sign in again would rebuild a working gate.
    if (getAccessType() !== 'none') return { ok: true };
    // Asked again after the waits, which can run to 45 s (review, 11 Nov 2026): if the card that asked has
    // gone, or a member signed in meanwhile, nothing here may sign anybody out or change persistence.
    if (!stillWanted()) return { ok: false, kind: 'superseded', message: '' };
    if (memberSessionHeld()) { window.location.reload(); return { ok: true }; }
    _unlocking = true;   // this exchange grants for itself, after its claim check — see `grantLateViewer`
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
    } finally {
        _unlocking = false;
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
    if (getAccessType() !== 'viewer') return;
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
    //
    // A RELOAD, NOT A NAVIGATION TO './#staff-pin' (v24.89). That navigation loads a page only when
    // the path it starts from differs. From `/index.html` it does — where every test began — but `/`
    // is how the station opens the Calendar (the start_url, the drawer's Calendar pill), and from
    // there the target differs by its fragment alone, so the browser only scrolled. The viewer was
    // signed out, the drawer closed as if locked, and the roster stayed on screen to be browsed:
    // reproduced in a browser on 22 Oct 2026, and live from late September. Rewriting the address in
    // place and reloading is the same from every path, and leaves no extra history entry behind.
    history.replaceState(null, '', './' + PIN_FIRST_HASH);
    window.location.reload();
}

// ── The workspace gate ──────────────────────────────────────────────────────────────────────────

/** The Calendar workspace: everything that implies usable roster data. The header and the nav
 *  drawer are deliberately NOT in this list — the guides are reachable without Calendar access, and
 *  locking the whole app to read the Railcard guide would be absurd. The Huddle and the documents
 *  used to be reachable too; since v23.17 their reads sit behind `calendar-doc-access.js`, which
 *  opens with the full grant (`grant`, above) — so the drawer still SHOWS them, and a tap while
 *  locked is answered with what to do rather than with the document. */
const WORKSPACE_IDS = ['calendarControls', 'installPrompt', 'notifPrompt', 'swipeHint', 'calendarDisplay', 'calendarLegend'];

/** @param {boolean} hidden */
function setWorkspaceHidden(hidden) {
    for (const id of WORKSPACE_IDS) {
        const el = document.getElementById(id);
        if (!el) continue;
        // The `hidden` ATTRIBUTE, not a CSS class or opacity: it removes the element from the
        // accessibility tree as well as the page, so a screen reader cannot read out a Calendar the
        // eye cannot see. But only where the stylesheet lets it: a `display` of the element's own
        // outranks the attribute, so each element here needs a `[hidden]` rule beside that `display`
        // (cal-docs-11 found the two prompt strips without one). And it is load-bearing: before the
        // first grant these nodes are empty, but a re-lock (`handleAccessLost`) does not reload, so
        // after one they hold the roster the grant drew.
        if (hidden) el.setAttribute('hidden', '');
        else el.removeAttribute('hidden');
    }
}

// ── The cards ───────────────────────────────────────────────────────────────────────────────────
//
// Wired at module scope, so a card can never be shown before its collaborators exist. All four are
// function declarations or an exported function in this file, so hoisting makes this safe here.
initLockCards({ unlockWithPin, getAccessType, setWorkspaceHidden, unlockUrl: UNLOCK_URL, onAwaitingInput: () => _onAwaitingInput?.() });

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
 * The RESULT is read from `decideAccess`, never from the boolean. The boolean could once report
 * success on an anonymous fallback (the `ENFORCE_NAMED_SESSION` switch, retired v24.34), and the
 * ground truth is the live user either way: an anonymous identity must never be granted `named`
 * access here — that is the whole substance of v20.12.
 *
 * @param {string} name
 * @returns {Promise<boolean>}
 */
async function trySilentReauth(name) {
    /** @type {ReturnType<typeof setTimeout>|undefined} */ let bound;
    try {
        // Bounded, like every other wait on this path. Timing out does not cancel the sign-in — it
        // just stops the button pretending to work; a late success is picked up by the watcher.
        await Promise.race([
            ensureNamedSession(name),
            new Promise(resolve => { bound = setTimeout(resolve, 8000); }),
        ]);
    } catch { /* a failed re-auth is the expected outcome for a migrated member */ }
    finally { clearTimeout(bound); }   // settled — the 8s bound must not outlive the answer (test audit, 7 Nov 2026)
    try {
        return decideAccess({ session: getSession(), firebaseUser: auth.currentUser }) === 'named';
    } catch { return false; }
}

/**
 * Re-lock a Calendar whose access has gone while it was open, and say why.
 *
 * Called by the sync chip when a read fails with `permission-denied` — which means the session
 * expired or was revoked, NOT that the network is poor. Those two need different words: an endless
 * "couldn't update, try again" against an expired session is a loop the member cannot win, and
 * they would reasonably conclude the app is broken.
 *
 * THE ONE CALL FOR EVERY ROUTE THAT LOSES ACCESS. The first load reaches it directly (its read, or
 * its chip's retry); a refused month read reaches it through calendar-overrides.js, which has
 * already shut the state by then. Either way the order is the same: the state shuts, and only then
 * does a card go up.
 */
export function handleAccessLost() {
    // SHUT FIRST, and before anything below can run. The roster reads and the documents both read
    // this state, so from this line neither can serve this device's saved copy behind the card that
    // is about to appear — and everything that must follow a loss (what each month was known to be,
    // the Huddle's subscription, the member's stored copy) is told from inside the write. So a
    // caller passes this function bare. Nothing has to be closed first, and a route that had to
    // remember a wrapper could re-lock with the local-cache read still open behind the card.
    if (hasCalendarAccess()) setCalendarAccess(false);
    // Already locked: the card is up and the reason has been said. (`_grantedAs`, not the state —
    // a refused month read shuts the state before it calls here, and its card is still owed.)
    if (_grantedAs === null) return;
    const wasNamed = _grantedAs === 'named';
    _grantedAs = null;
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
 * @param {{ onGranted: () => void, onEveryGrant?: (() => void)|null, paintBeforeDecision?: (() => boolean)|null, onAwaitingInput?: (() => void)|null }} deps
 *   onGranted runs ONCE, the first time access is granted. It is how `calendar-app.js` defers every
 *   piece of Calendar initialisation — the member dropdown, the render, the fetch, the swipe handler
 *   — so that none of it exists while locked. Running it twice would duplicate all of that.
 *   onEveryGrant runs on EVERY grant, including one that follows a re-lock, and before `onGranted`.
 *   Anything of the PAGE's that a re-lock takes away comes back here rather than in `onGranted`, or
 *   it stays away for the rest of the session — see the note in `grant`. The roster reads and the
 *   documents are not among them: `grant` opens both itself, before either hook runs.
 *   paintBeforeDecision (v24.59) puts the member's OWN stored roster in the lock slot while the
 *   decision runs, and says whether it did. It is NOT a grant: no override read opens, `onGranted`
 *   is not spent, and any card the decision puts up replaces it (the slot never stacks). Not called
 *   on a `#staff-pin` open, which has asked for the PIN.
 *   onAwaitingInput (Oct 2026) is told when a card that needs somebody to TYPE goes up — the PIN
 *   card or the member's come-back card — so the page's speed sample stops there. Telemetry stays
 *   in calendar-app.js; this module only says when.
 * @returns {Promise<'named'|'viewer'|'none'>}
 */
export async function initCalendarAccess({ onGranted, onEveryGrant = null, paintBeforeDecision = null, onAwaitingInput = null }) {
    _onGranted = onGranted;
    _onEveryGrant = onEveryGrant;
    _onAwaitingInput = onAwaitingInput;
    // Hide the workspace SYNCHRONOUSLY, before any await. The decision below is asynchronous, and
    // between here and there the browser paints — so leaving the workspace visible would flash an
    // empty Calendar shell at a member who is about to be shown their roster, and worse, would show
    // it to somebody who is about to be shown the PIN.
    setWorkspaceHidden(true);
    document.body.classList.add('calendar-locked');

    // Was the PIN card asked for first? Read ONCE and removed whatever the decision (`takePinFirst`).
    const pinFirst = takePinFirst();

    // Say something if the decision is slow (v20.80). Scheduled BEFORE the await, cleared by every
    // path out of it — `grant()` and both cards call `hideLockPanel()`, which owns the timer.
    armSkeleton(SKELETON_AFTER_MS);
    // The member's own roster instead of a skeleton, when this device holds one (v24.59). Mounting it
    // disarms the skeleton timer, and the skeleton will not replace it (calendar-lock-slot.js).
    if (!pinFirst && paintBeforeDecision) {
        try { paintBeforeDecision(); } catch (e) { console.warn('[CalendarAccess] early paint failed', e); }
    }

    /** @type {'named'|'viewer'|'none'} */
    let type;
    try { type = await resolveAccess(); }
    catch (e) { console.error('[CalendarAccess] decision failed', e); type = 'none'; }

    // There is no third, "open" outcome any more. Until v24.34 a `CALENDAR_PIN_ACCESS` switch could
    // turn `none` into an anonymous, ungated Calendar; it was retired because the rules it relied
    // on are gone — override and document reads need a member claim or the PIN's `calendarViewer`
    // (v20.12, v23.18), so the anonymous session it started could read nothing, and flipping it
    // would have shown the base roster as though it were current. Rollback is reverting a release.
    if (type === 'named' || type === 'viewer') { grant(type); return type; }

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
    // device already knows is migrated, see silent-sign-in.js's memory), or at the defer bound if
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
    // (every grant starts the roster reads afresh), so whichever route arrives second stands down.
    const heldNow = getAccessType();
    if (heldNow !== 'none') return heldNow;
    if (ok) { grant('named'); return 'named'; }
    showMemberPanel(held.name);
    // `null` means the attempt is still in flight past the defer bound. A late success is still a
    // success: honour it exactly the way the watcher honours a late restore.
    if (ok === null) silent.then(late => { if (late && getAccessType() === 'none') grant('named'); });
    return 'none';
}
