// @ts-check
/**
 * calendar-access.js — the Calendar's access gate: decide, hold the answer, and re-lock.
 *
 * Owns: the access decision at boot, the `calendarAccessReady` promise every Calendar subsystem
 *   waits on, the sign-in cards' grant (`finishSignIn`), and re-locking.
 * Does NOT own: the RULES (calendar-access-core.js — pure, tested in Node), override fetching
 *   (calendar-overrides.js), any rendering (calendar-renderer.js / calendar-app.js), or named
 *   member authentication (session.js, which remains the sole authority on who the member is).
 *   Nor the ANSWER once decided: whether access is held is kept ONCE, in calendar-access-state.js,
 *   which this module WRITES (`grant`, `handleAccessLost`) and the two gates read.
 * Edit here for: the access bootstrap order, what a lost grant shows.
 *
 * ── THE POINT OF THE WHOLE MODULE ───────────────────────────────────────────────────────────────
 *
 * `overrides` used to be world-readable (`allow read;`) because the Calendar had no session. It now
 * requires a real member `name` claim. That change is only safe if NOTHING can put roster data on
 * screen before this module has said yes — and the dangerous path is not the network read, which the
 * rules now stop. It is the LOCAL FIRESTORE CACHE: `getDocsFromCache` is served from IndexedDB without
 * contacting the server, so security rules are never consulted. A browser that was granted yesterday
 * still holds every override it saw.
 *
 * So the gate is structural, not cosmetic: until access is first granted, `calendar-app.js` does not
 * initialise the Calendar AT ALL — no member dropdown, no fetch, no render, no Team View — and after a
 * re-lock (`handleAccessLost`), which cannot un-build it, the workspace is hidden and the grid the
 * grant drew is emptied; and `calendar-overrides.js` independently refuses to serve the cache. Two
 * gates, because the first is a call-order property that a future edit could quietly break and the
 * second is a hard refusal that it could not.
 *
 * ── ONLY A NAMED SIGN-IN OPENS IT: THE STAFF PIN IS RETIRED (owner, 23 Nov 2026) ─────────────────
 *
 * A browser holding nothing is shown the member SIGN-IN card (`showSignInPanel` — the shared
 * `login-overlay.js` card, mounted inline), and a browser holding a member's session whose identity
 * did not restore is shown that member's own way back (`showMemberPanel`). There is no second door.
 *
 * A browser can still hold a session of the shared staff-PIN viewer from before the retirement. The
 * decision's first step, `reconcileExpiredIdentity()` (session.js), signs it out — the same teardown
 * every other page has always run, now run here without the flag that used to keep the viewer — and
 * the sign-in card then says ONE line about why (staff-pin-ended.js). `decideAccess` never grants a
 * viewer either, so a teardown that has not landed yet still opens nothing. The viewer's remaining
 * plumbing (`isViewerUser`, viewer-shed.js, the viewer branch of `authReady`, `letViewerWritesGo`) is
 * kept until the cleanup release, which deletes the account. A `#staff-pin` left in an address or a
 * bookmark means nothing: nothing reads it, and the page opens on the sign-in card as it would anyway.
 *
 * The cards share ONE slot (`calendar-lock-slot.js`) so at most one of them can exist at a time.
 */

import { auth, onAuthStateChanged, currentUserAfterBoot } from './firebase-client.js';
import { getSession, reconcileExpiredIdentity, ensureNamedSession, ACCESS_DECISION_BUDGET_MS } from './session.js';
import { decideAccess } from './calendar-access-core.js';
import { lockCardId, armSkeleton, showBootSkeleton, setWorkspaceHidden } from './calendar-lock-slot.js';
// The two cards this gate can put where the Calendar goes. They DRAW; this file DECIDES —
// the split is along the line this module's own header already stated. `initLockCards` below hands
// them their dependencies; two are this file's, which they could not import back without a cycle.
import { initLockCards, hideLockPanel, showSignInPanel,
         showMemberPanel, dismissSignInForm, signInInFlight, afterSignInSettles } from './calendar-lock-cards.js';
import { hasCalendarAccess, setCalendarAccess } from './calendar-access-state.js';

// ACCESS_DECISION_BUDGET_MS (session.js) is the WHOLE decision's deadline, not a per-step one. Past
// it the answer is `none`, a card, which is recoverable — and the late-identity watcher corrects it
// when an identity lands.

/**
 * WHICH access the grant in force is: the kind, and only the kind — `named`, the only one since the
 * staff PIN was retired (23 Nov 2026), kept as a kind so the page's `=== 'named'` questions read as
 * before.
 *
 * Whether access is HELD is not kept here. That is `hasCalendarAccess()`, the one copy the roster
 * and document gates read too (calendar-access-state.js), so this module cannot report `named`
 * over gates that have shut: `getAccessType` asks the state every time. A `'none'` never
 * goes in this variable: it would be a second copy of that fact.
 *
 * Null until the first grant, and again once this module has put a lock card up for an access that
 * has gone. That second null is what `handleAccessLost` goes by. A refused month read shuts the
 * state BEFORE it calls here (calendar-overrides.js), so by then the state can no longer say whether
 * a card is owed, or already up.
 * @type {'named'|null}
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
/** Runs when a sign-in on a card is granted IN PLACE, before the grant (`finishSignIn`): the page's
 *  own things built at load for nobody. @type {(() => void)|null} */
let _onSignedInInPlace = null;
/** Has this page EVER been granted? Reset only as `initCalendarAccess` starts, before any grant: a
 *  page built for one grant is not rebuilt in place for a sign-in (`finishSignIn`). */
let _everGranted = false;
/** Moves on every grant. A grant that WAITED (`grantNamedOnceFree`, a late silent sign-in) lands under
 *  the lock it waited under only: "none" alone cannot tell still-locked from granted-lost-and-locked,
 *  and the wait re-granted, in place, the access the rules had just refused (F1, 21 Nov 2026). */
let _accessEpoch = 0;
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
 * **Two promises.** `calendarAccessReady` answers "may this browser SEE the roster"; the error
 * reporter, the usage counters, the latency sampler, the document-open counters and the
 * push-subscription renewal WRITE to Firestore, which needs an identity. Today the two are the same
 * instant (a grant always holds a real user), and the split is kept because the contract is still the
 * right one: anything that writes awaits THIS, and anything that renders awaits the other. Getting it
 * backwards is silent in both directions: a render that waits costs latency nobody attributes, and a
 * write that does not is simply rejected.
 *
 * Like its sibling it never rejects, and while the Calendar is locked it never resolves — a browser
 * that was never shown the roster has nothing worth recording.
 */
export const calendarAuthReady = /** @type {Promise<void>} */ (new Promise(resolve => { _resolveAuth = () => resolve(); }));

/** TEST-ONLY: a fresh page — never granted, and nothing an earlier test armed may grant into it. */
export function _resetPageForTest() { _everGranted = false; _accessEpoch++; }

/** @returns {'named'|'none'} the access this browser currently holds — `none` the moment the state
 *  shuts, by whichever route (see `_grantedAs`). */
export function getAccessType() { return _grantedAs !== null && hasCalendarAccess() ? _grantedAs : 'none'; }

// ── The decision ────────────────────────────────────────────────────────────────────────────────

/**
 * Resolve what access this browser has, tearing down anything stale first.
 *
 * THE TEARDOWN IS THE PLAIN `reconcileExpiredIdentity()` — the one every protected page runs. Until the
 * staff PIN was retired (23 Nov 2026) this page passed `preserveCalendarViewer`, because the shared
 * viewer is a non-anonymous identity with no local session, exactly the shape the teardown ends. Now
 * ending it is the point: a browser still holding a viewer session is signed out HERE, on its next
 * Calendar load, and the sign-in card says why (staff-pin-ended.js). `decideAccess` refuses a viewer
 * too, so a teardown still in flight past the budget opens nothing meanwhile.
 *
 * @returns {Promise<'named'|'none'>}
 */
async function resolveAccess() {
    // ── ONE BUDGET FOR THE WHOLE DECISION ───────────────────────────────────────────────────────
    // The deadline belongs to the DECISION, and each step gets what is left of it: two sequential
    // bounds waiting on the same first auth emission would ADD. The worst case is the budget.
    const started   = Date.now();
    const remaining = () => Math.max(0, ACCESS_DECISION_BUDGET_MS - (Date.now() - started));
    /** @type {ReturnType<typeof setTimeout>|undefined} */ let reconcileBound;
    try {
        // The race leaves reconcile running in the background if it is merely slow: it is an
        // idempotent teardown, and the decision below reads ground truth either way.
        await Promise.race([
            reconcileExpiredIdentity(),
            new Promise(resolve => { reconcileBound = setTimeout(resolve, remaining()); }),
        ]);
    } catch { /* best effort — the decision below is made from ground truth either way */ }
    finally {
        // Settled: the losing bound has nothing left to decide.
        clearTimeout(reconcileBound);
    }
    // `auth.currentUser` alone MISSES a cold restore, and would put a sign-in card in front of a
    // signed-in member. `currentUserAfterBoot` is the SHARED wait on the boot restore (firebase-client.js).
    const user = await currentUserAfterBoot(remaining());
    return decideAccess({ session: getSession(), firebaseUser: user });
}

/**
 * Keep watching after the decision, and GRANT the moment a named identity turns up.
 *
 * ── THE DECISION WAS MADE ONCE, AND THAT WAS THE BUG ────────────────────────────────────────────
 *
 * `resolveAccess` gives the restore a bounded wait — it has to, or a wedged auth layer holds the
 * Calendar at a blank screen for ever. But a bound alone is a CLIFF: a restore landing a millisecond
 * late would leave a signed-in member in front of a sign-in card until a reload. This turns the cliff
 * into a window: the bound decides what to SHOW promptly, and a late identity corrects it. A grant
 * still requires exactly what `decideAccess` required, and the listener is dropped the moment it
 * fires or access is granted by any other route. Deliberately NOT time-limited.
 *
 * A leftover staff-PIN session that restores late is NOT granted (it was, as the viewer, until the PIN
 * was retired on 23 Nov 2026): `decideAccess` answers `none` for it, and the teardown still running
 * from `resolveAccess` signs it out when it lands.
 */
function watchForLateNamedIdentity() {
    let off = /** @type {null | (() => void)} */ (null);
    const stop = () => { if (off) { try { off(); } catch { /* noop */ } off = null; } };
    try {
        off = onAuthStateChanged(auth, (/** @type {any} */ u) => {
            // Only ever UPGRADES, and only from locked. A grant that already happened owns the
            // page; re-granting would run the workspace hooks a second time.
            if (getAccessType() !== 'none') { stop(); return; }
            if (decideAccess({ session: getSession(), firebaseUser: u }) !== 'named') return;
            // A sign-in typed on a card may be putting this identity in place: ITS success grants
            // (`finishSignIn`), after the session is saved and the forced set-password step's
            // marker written, so this waits for it (`grantNamedOnceFree`).
            stop();
            console.warn('[CalendarAccess] a named identity restored after the access decision — granting.');
            grantNamedOnceFree();
        }, () => stop());
    } catch { /* an auth layer that cannot be watched simply leaves the panel up */ }
    return stop;
}

/** Commit an access decision exactly once, and let the Calendar start. */
function grant() {
    _everGranted = true;
    _accessEpoch++;   // a wait decided before this grant is stale from here
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
    // HERE, AND NOT A LINE EARLIER OR LATER. After the card has gone and the workspace is back: a
    // document a locked tap was waiting for opens from inside the write, over the Calendar. And
    // BEFORE both hooks: the first render's month read and a re-grant's repaint must find the gate
    // open, or the month sits on "Checking this month" for the session.
    _grantedAs = 'named';
    setCalendarAccess(true);
    // TWO hooks, because a grant is two different things. Building the workspace must happen ONCE
    // (twice would re-wire the swipe and re-launch the initial fetch); what a re-lock takes away must
    // come back on EVERY grant. (A re-lock followed by an in-place grant was the normal path while the
    // staff PIN rotated; a lapsed member's sign-in reloads instead, `finishSignIn`, but the hook stays
    // the one place a re-grant's repaint belongs.) The gates are the write's to reopen (above).
    if (_onEveryGrant) { try { _onEveryGrant(); } catch (e) { console.error('[CalendarAccess] the every-grant hook failed', e); } }
    if (_onGranted) { const fn = _onGranted; _onGranted = null; try { fn(); } catch (e) { console.error('[CalendarAccess] start failed', e); } }
    if (_resolveAccess) { const r = _resolveAccess; _resolveAccess = null; r(); }
    // The WRITE gate. A named grant already holds a user, so it is the same instant.
    if (_resolveAuth) { const r = _resolveAuth; _resolveAuth = null; r(); }
}

/**
 * A sign-in on one of the cards has succeeded: grant IN PLACE, or reload (ROADMAP_HISTORY.md →
 * "Calendar sign-in without the reload"). Until v26.40 it always reloaded, and the reload did three jobs.
 *
 * IN PLACE when this page has never been granted and the live session and identity decide `named`.
 * Nothing has been built for anybody, so the grant builds the Calendar for this member exactly as the
 * reload's boot would, and does the three jobs: `onSignedInInPlace` rebuilds what the page built at
 * load for nobody (the menu, the Back guard's owner); the first grant's `onGranted` runs the forced
 * set-password step, whose marker the sign-in wrote before calling here; and the grant's one write
 * opens a document a locked tap was holding.
 *
 * A RELOAD otherwise, as before: a page granted once (to a member whose access
 * lapsed mid-visit) holds a Calendar built for that grant, which no in-place repaint is sure to reach;
 * and a decision that is not `named` is the boot's to make from ground truth.
 * @returns {'in-place'|'reload'}
 */
export function finishSignIn() {
    if (_everGranted || decideAccess({ session: getSession(), firebaseUser: auth.currentUser }) !== 'named') {
        window.location.reload();
        return 'reload';
    }
    dismissSignInForm({ evenMidSignIn: true });   // the come-back card's full-screen form; the front door's goes with the slot
    if (_onSignedInInPlace) { try { _onSignedInInPlace(); } catch (e) { console.error('[CalendarAccess] the signed-in hook failed', e); } }
    grant();
    return 'in-place';
}

// ── The cards ───────────────────────────────────────────────────────────────────────────────────
//
// Wired at module scope, so a card can never be shown before its collaborators exist. Each is a
// function declaration here or an import (the workspace switch is calendar-lock-slot.js's), so
// hoisting and import binding make this safe here.
initLockCards({ getAccessType, setWorkspaceHidden, onAwaitingInput: () => _onAwaitingInput?.(), finishSignIn });

/** How long the decision may take before the page has to say something. Long enough that a normal
 *  boot — where access resolves in the same tick the workspace would have rendered — never flashes
 *  it, short enough that nobody stares at nothing. */
const SKELETON_AFTER_MS = 400;

/** How long the member's silent re-establishment may keep the skeleton up before the sign-in card
 *  goes up anyway (see the boot path) — the bound is for a HANGING attempt (a rejection shows the
 *  card at once). Shorter than `trySilentReauth`'s own 8s ceiling on purpose: the attempt keeps
 *  running behind the card and a late success still grants. */
const SILENT_BEFORE_CARD_MS = 4000;

/** Grant `named` now — or, while a card's own sign-in is in flight, once it has settled, and only if
 *  nothing granted meanwhile: its success grants for itself (`finishSignIn`), after the forced
 *  set-password step's marker is written, and a grant a moment earlier ran the first grant without
 *  it (review, 20 Nov 2026). Called by the late-identity watcher and the late silent sign-in. */
function grantNamedOnceFree() {
    if (!signInInFlight()) { grant(); return; }
    const epoch = _accessEpoch;   // the lock this stood down under: the only one it may grant
    afterSignInSettles(() => {
        if (_accessEpoch === epoch && getAccessType() === 'none'
            && decideAccess({ session: getSession(), firebaseUser: auth.currentUser }) === 'named') grant();
    });
}

/**
 * Re-establish the member's own Firebase identity with nothing typed, if that is possible.
 *
 * `ensureNamedSession` with no password tries ONLY the derived surname (PASSWORD_DESIGN.md §3.4), which
 * is what makes this safe to fire unprompted: for a member still on the default it restores the exact
 * identity they already had, and for a migrated member it fails cleanly against a password nobody
 * chose. It is the same page-load re-establishment every other coordinator already performs — the
 * Calendar simply never had a reason to until access depended on it.
 *
 * The RESULT is read from `decideAccess`, never from the boolean: the ground truth is the live user,
 * and an anonymous identity must never be granted `named` access here.
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
    finally { clearTimeout(bound); }   // settled — the 8s bound must not outlive the answer
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
    // SHUT FIRST, and before anything below can run: from this line neither the roster reads nor the
    // documents can serve this device's saved copy behind the card, and everything that must follow
    // a loss is told from inside the write. So a caller passes this function bare.
    if (hasCalendarAccess()) setCalendarAccess(false);
    // Already locked: the card is up and the reason has been said. (`_grantedAs`, not the state —
    // a refused month read shuts the state before it calls here, and its card is still owed.)
    if (_grantedAs === null) return;
    _grantedAs = null;
    document.body.classList.remove('calendar-unlocked');
    // The way back in is the member's own (CALENDAR_DATA.md 11): their come-back card while their
    // session is held, the front door with the reason on it once the session itself has gone.
    const why = 'Calendar access has expired. Sign in again to carry on.';
    const held = getSession();
    if (held?.name) showMemberPanel(held.name, why);
    else showSignInPanel(why).catch(() => {});
}

// ── Boot ────────────────────────────────────────────────────────────────────────────────────────

/**
 * Decide access and either start the Calendar or show a sign-in card.
 *
 * @param {{ onGranted: () => void, onEveryGrant?: (() => void)|null, paintBeforeDecision?: (() => boolean)|null, onAwaitingInput?: (() => void)|null, onSignedInInPlace?: (() => void)|null }} deps
 *   onGranted runs ONCE, the first time access is granted. It is how `calendar-app.js` defers every
 *   piece of Calendar initialisation — the member dropdown, the render, the fetch, the swipe handler
 *   — so that none of it exists while locked. Running it twice would duplicate all of that.
 *   onEveryGrant runs on EVERY grant, including one that follows a re-lock, and before `onGranted`.
 *   Anything of the PAGE's that a re-lock takes away comes back here rather than in `onGranted`, or
 *   it stays away for the rest of the session — see the note in `grant`. The roster reads and the
 *   documents are not among them: `grant` opens both itself, before either hook runs.
 *   paintBeforeDecision puts the member's OWN stored roster in the lock slot while the
 *   decision runs, and says whether it did. It is NOT a grant: no override read opens, `onGranted`
 *   is not spent, and any card the decision puts up replaces it (the slot never stacks).
 *   onAwaitingInput is told when a card that needs somebody to TYPE goes up — the sign-in card or
 *   the member's come-back card — so the page's speed sample stops there. Telemetry stays in
 *   calendar-app.js; this module only says when.
 *   onSignedInInPlace runs when a sign-in on a card is granted without a reload, BEFORE that grant:
 *   what the page built at load for whoever was signed in then is rebuilt here (`finishSignIn`).
 * @returns {Promise<'named'|'none'>}
 */
export async function initCalendarAccess({ onGranted, onEveryGrant = null, paintBeforeDecision = null, onAwaitingInput = null, onSignedInInPlace = null }) {
    _onGranted = onGranted;
    _onEveryGrant = onEveryGrant;
    _onAwaitingInput = onAwaitingInput;
    _onSignedInInPlace = onSignedInInPlace;
    _everGranted = false;   // a page starts never granted; the boot calls this once, before any grant
    // Hide the workspace SYNCHRONOUSLY, before any await. The decision below is asynchronous, and
    // between here and there the browser paints — so leaving the workspace visible would flash an
    // empty Calendar shell at a member who is about to be shown their roster, and worse, would show
    // it to somebody who is about to be shown a sign-in card.
    setWorkspaceHidden(true);
    document.body.classList.add('calendar-locked');

    // Say something if the decision is slow. Scheduled BEFORE the await, cleared by every
    // path out of it — `grant()` and both cards call `hideLockPanel()`, which owns the timer.
    armSkeleton(SKELETON_AFTER_MS);
    // The member's own roster instead of a skeleton, when this device holds one. Mounting it
    // disarms the skeleton timer, and the skeleton will not replace it (calendar-lock-slot.js).
    if (paintBeforeDecision) {
        try { paintBeforeDecision(); } catch (e) { console.warn('[CalendarAccess] early paint failed', e); }
    }

    /** @type {'named'|'none'} */
    let type;
    try { type = await resolveAccess(); }
    catch (e) { console.error('[CalendarAccess] decision failed', e); type = 'none'; }

    // There is no other "open" outcome: override and document reads need a member claim, so an
    // anonymous identity or a leftover PIN viewer could read nothing. Rollback is reverting a release.
    if (type === 'named') { grant(); return type; }

    // Locked. Two things happen before the card goes up, and both exist because the decision above
    // is a SNAPSHOT of a restore that is not always finished.
    //
    //   · Keep listening. A named identity that lands after the bound now grants instead of being
    //     ignored until the member thinks to reload.
    //   · Ask WHO. A browser holding a live local session is not an unknown visitor at a shared PC;
    //     it is a member whose identity has gone, and the answer for them is their own way back, not
    //     the front door. See `showMemberPanel`.
    watchForLateNamedIdentity();
    const held = getSession();
    if (!held?.name) {
        // Nothing held: the front door, the sign-in card — the only one there is. A device the
        // teardown has just taken a leftover staff-PIN session from is told why on it (staff-pin-ended.js).
        await showSignInPanel();
        return 'none';
    }

    // ── THE SILENT ATTEMPT RUNS BEHIND THE SKELETON, NOT BEHIND A SIGN-IN CARD ─────────────────
    //
    // Behind a card, every member whose restore merely missed the boot budget SAW A SIGN-IN SCREEN —
    // routine, not an edge case (LATENCY.md → First reading), and what staff meant by "the app keeps
    // asking for my password". The card is DEFERRED, not withheld: it appears the moment silence
    // definitively fails (a rejection returns in well under a second — instantly for a member this
    // device knows is migrated, silent-sign-in.js), or at the defer bound if the attempt is hanging.
    // Put the skeleton up NOW unless it already is — the timer may not have fired when the decision
    // was quick, and whatever else the slot might hold is stale for this boot. `showBootSkeleton`
    // replaces rather than stacks, and its `hideLockPanel` disarms the pending timer.
    if (lockCardId() !== 'calendarBooting') showBootSkeleton();
    const lock = _accessEpoch;   // a late success may grant under THIS lock only
    const silent = trySilentReauth(held.name);
    /** @type {any} */ let deferTimer = null;
    // ── THE WAIT MAY NOT BE ABLE TO STRAND THE MEMBER ───────────────────────────────────────────
    // `trySilentReauth` catches everything today, but a rejection let through here would build no
    // card and leave the member on the skeleton. So it is caught here: `false` shows the sign-in
    // card, which is the recoverable state.
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
    if (ok) { grant(); return 'named'; }
    showMemberPanel(held.name);
    // `null` means the attempt is still in flight past the defer bound. A late success is still a
    // success: honour it exactly the way the watcher honours a late restore.
    if (ok === null) silent.then(late => { if (late && _accessEpoch === lock && getAccessType() === 'none') grantNamedOnceFree(); });
    return 'none';
}
