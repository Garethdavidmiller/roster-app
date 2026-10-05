// @ts-check
/**
 * page-session.js — how a signed-in page LEAVES a session, and what it does when the session leaves
 * IT (v24.52, external technical-debt review item 3).
 *
 * Four routines that every protected page used to assemble for itself, and got slightly different
 * every time. Reading the seven coordinators side by side is how the differences were found, and
 * three of them were defects rather than style:
 *
 *   1. UNSAVED WORK AT SIGN-OUT. Links asked "Sign out anyway?" before signing out. Admin (the week
 *      grid) and Overtime (the availability form) did not: the drawer released the device's push
 *      record and cleared the session FIRST, and only the reload that followed met the page's
 *      `beforeunload` — so on a phone, where that dialog is suppressed, the edits were lost without
 *      a word, and on a desktop a "Cancel" left the edits on screen with no session behind them.
 *   2. BACK AFTER SIGN-OUT, ON A SHARED DEVICE. The Pay Calculator left with `location.replace` and
 *      re-checked the identity when the browser restored it from the back/forward cache. No other
 *      page did either, so Back could put the previous member's Operations, Links or Settings page
 *      back on screen, data and all, for whoever picked the device up next.
 *   3. A SESSION REVOKED LATER. Admin, Operations, Settings and Links offered the sign-in again when
 *      the account went mid-visit (`watchIdentityLoss`, v24.37–24.38). Overtime never did, so a
 *      revoked member was left on a page whose every save would fail.
 *
 * ── WHAT EACH ROUTINE OWNS ─────────────────────────────────────────────────────────────────────
 *
 * `warnOnUnload(isDirty)` — the browser's own "Leave site?" for unsaved work, which stands down once
 * a sign-out has been ANSWERED, so the member is not asked twice.
 *
 * `askBeforeSignOut(isDirty)` — the drawer's `beforeSignOut`. It runs BEFORE anything is released,
 * so a Cancel leaves the session, the push record and the work exactly as they were.
 *
 * `signOutAndLeave({ to })` — clear the session, then leave WITHOUT leaving this page in the history
 * (`replace`, or a reload of the same entry). `to: null` stays on the page, which then shows its own
 * sign-in; a string goes there.
 *
 * `reloadIfRestoredForSomeoneElse()` — when the browser restores this page from the back/forward cache
 * and the signed-in member is no longer the one the page was built for, reload it. `replace` only
 * keeps THIS page out of the history; every page the member visited earlier is still there, so the
 * guard has to be on all of them. Since v24.56 it also reloads a page left OPEN in another tab when
 * the session there changes to a different member, or to nobody.
 *
 * `guardNamedSession({ page, member, established, signIn })` — the follow-up every named page runs
 * once its Firebase session settles: an own session that cannot be confirmed is asked to sign in
 * again at once, and one that goes LATER gets the same sign-in rather than a dead page. Both paths
 * clear the session and tear down the drawer first, because the drawer was wired with the old
 * member's name and pills, and on a shared device that must not stay reachable behind the sign-in.
 *
 * ── WHAT IT DELIBERATELY DOES NOT OWN ──────────────────────────────────────────────────────────
 *
 * The real differences between pages stay in their coordinators, passed in rather than flattened:
 * which page id the policy is asked about, what "sign in again" looks like (Admin's own login, with
 * reload-on-success), where a sign-out lands (the app root, or this page's own sign-in), and what
 * counts as unsaved. The Calendar (the staff PIN, and a member card rather than a page sign-in) and
 * the Pay Calculator (a SOFT policy that by design never asks for a login) do not use
 * `guardNamedSession`; their reasons are in their own headers. Neither does this module decide
 * access — `auth-policy.js` does, and the Firestore rules are the boundary.
 */

import { auth, onAuthStateChanged } from './firebase-client.js';
import { getSession, clearSession, AUTH_KEY } from './session.js';
import { requirePage } from './auth-policy.js';
import { getAuthSnapshot } from './auth-state.js';
import { watchIdentityLoss } from './claim-retry.js';
import { resetNavPanel } from './nav-panel.js';
import { confirmDialog } from './overlay.js';
import { writesInFlight } from './slow-save.js';

/** Set once a sign-out has been answered, so `warnOnUnload` does not ask a second time. */
let _leaving = false;

/**
 * Warn before the tab closes or navigates while there is unsaved work.
 * @param {() => boolean} isDirty
 */
export function warnOnUnload(isDirty) {
    window.addEventListener('beforeunload', (e) => {
        if (!_leaving && isDirty()) { e.preventDefault(); e.returnValue = ''; }
    });
}

/**
 * The drawer's `beforeSignOut`: with unsaved work, or a save still on its way, ask first; without
 * either, carry on. Resolves `false` to cancel, in which case nothing has been released.
 *
 * A SAVE STILL SENDING is asked about too (v24.56, auth review). The service-worker reload already
 * waits for one (review A13 — a range booking commits in chunks, and leaving between two of them
 * strands the rest); a sign-out did not, and is worse than a reload, because the queued remainder
 * then reaches the server with no account behind it and is refused, with nothing on screen to say so.
 * @param {() => boolean} isDirty
 * @returns {() => Promise<boolean>}
 */
export function askBeforeSignOut(isDirty) {
    return async () => {
        if (writesInFlight() > 0) {
            // Both facts when both are true (v24.57, review) — one question must not hide the other.
            const alsoDirty = isDirty() ? ' You also have unsaved changes.' : '';
            return confirmDialog({
                message: `A change may still be on its way to the server — if you sign out now it may not be saved.${alsoDirty} Sign out anyway?`,
                confirmLabel: 'Sign out', danger: true,
            });
        }
        return !isDirty() || await confirmDialog({
            message: 'You have unsaved changes. Sign out anyway?', confirmLabel: 'Sign out', danger: true,
        });
    };
}

/**
 * Clear the session and leave, keeping this page out of the history.
 * @param {{ to?: string|null }} [opts] `null` (the default) stays here and shows this page's sign-in.
 */
export function signOutAndLeave({ to = null } = {}) {
    _leaving = true;
    clearSession();
    if (to === null) window.location.reload();
    else window.location.replace(to);
}

/** Whether the back/forward-cache guard is already installed (a coordinator re-entered by an in-place
 *  sign-in calls it twice). */
let _restoreGuarded = false;

/**
 * Reload this page if the browser restores it from the back/forward cache for anybody but the
 * member it shows — including nobody, after a sign-out.
 *
 * TWO identities are compared, and a restore is let through only when it matches BOTH:
 *   - who the page was BUILT for (when this ran), which is what its data belongs to. A member who
 *     signs in as somebody else in ANOTHER TAB changes the session while this page still shows the
 *     first member; comparing only at `pagehide` would then record the newcomer and wave the first
 *     member's page back in for them. That is the case the Pay Calculator's original guard caught.
 *   - who was signed in when it was LEFT. An in-place sign-in moves a page from nobody to a member
 *     without a load; the built-for identity alone would miss a later change there.
 * Matching both costs an unneeded reload in one harmless case (a page signed into in place and
 * restored for the same member). The other direction would show one member's data to another.
 */
export function reloadIfRestoredForSomeoneElse() {
    if (_restoreGuarded) return;
    _restoreGuarded = true;
    const builtFor = getSession()?.name ?? null;
    let leftAs = builtFor;
    window.addEventListener('pagehide', () => { leftAs = getSession()?.name ?? null; });
    window.addEventListener('pageshow', (e) => {
        const now = getSession()?.name ?? null;
        if (e.persisted && (now !== builtFor || now !== leftAs)) window.location.reload();
    });
    // ANOTHER TAB, WHILE THIS ONE IS OPEN (v24.56, auth review). The restore above covers Back; a
    // tab left open did nothing at all — sign out in one tab of a shared PC and Operations stayed
    // fully rendered in the next, and a colleague signing in elsewhere left this tab showing the
    // first member while every save went out on the colleague's token. `watchIdentityLoss` cannot
    // see either: it acts only when NOBODY is signed in and the session still names this member,
    // and a sign-out elsewhere clears the session first. The browser fires `storage` in every OTHER
    // tab of the origin, with the value before and after, so the two names compare directly — a
    // renewal for the same member changes nothing and reloads nothing.
    window.addEventListener('storage', (e) => {
        if (e.key !== AUTH_KEY) return;
        if (sessionName(e.oldValue) !== (getSession()?.name ?? null)) window.location.reload();
    });
}

/** The member a stored session value names, or null. @param {string|null|undefined} raw */
function sessionName(raw) {
    try { return (raw && JSON.parse(raw)?.name) || null; } catch { return null; }
}

/**
 * Once the page's own Firebase session settles: sign in again now if it could not be confirmed, and
 * again later if the account goes mid-visit.
 * @param {{ page: string, pageLabel: string, member: string, established: Promise<any>|any,
 *           signIn?: () => void }} opts
 *        `signIn` defaults to the shared in-place sign-in, reloading on success.
 * @returns {Promise<void>}
 */
export function guardNamedSession({ page, pageLabel, member, established, signIn }) {
    // Loaded on demand: the Calendar and the Pay Calculator import this module for the sign-out
    // routines and never call this one, and the sign-in is 44 KB they would otherwise load at start.
    // Every page that DOES call it already has the module (it shows its own sign-in at load).
    const showSignIn = signIn ?? (() => import('./login-overlay.js')
        .then(({ initLoginOverlay }) => initLoginOverlay({ pageLabel, onSuccess: () => window.location.reload() }))
        .catch((err) => { console.error('[page-session] sign-in could not load:', err); window.location.reload(); }));
    const relogin = () => { clearSession(); resetNavPanel(); showSignIn(); };
    return Promise.resolve(established).then(() => {
        if (requirePage(getAuthSnapshot(), page).decision === 'login') { relogin(); return; }
        watchIdentityLoss({
            uid: auth.currentUser?.uid,
            watch: (cb) => onAuthStateChanged(auth, cb),
            stillLost: () => !auth.currentUser && getSession()?.name === member,
            onLost: relogin,
        });
    });
}
