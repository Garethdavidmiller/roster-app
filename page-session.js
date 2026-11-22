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
 * `askBeforeLeavingByDrawer(isDirty)` — the same question asked IN the page, before a link in the
 * drawer or the About panel leaves it, because a phone never shows the browser's. `leaveAfterAsking`
 * asks it for one control (a header logo), and `LEAVE_ANSWERED` is how another surface says it asked.
 *
 * `keepDraftWhenHidden(isDirty, slot)` — for the exits nothing can ask about (iOS discarding a hidden
 * page, a swipe back): a copy of the unsaved work, kept when the page is hidden and offered on the
 * next load (unsaved-draft.js). An answered leave or sign-out is a discard, so it keeps nothing.
 *
 * `onReturnToPage(afterMs, fn)` — a page that comes back into view after `afterMs` away, which an
 * installed app does instead of reloading: iOS keeps it resident for days.
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
 * the session there changes to a different member, or to nobody. `rebaseRestoreGuard()` tells it a
 * page has been rebuilt in place for whoever just signed in, so a restore for them is not reloaded.
 *
 * `guardNamedSession({ page, member, established, signIn })` — the follow-up every named page runs
 * once its Firebase session settles: an own session that cannot be confirmed is asked to sign in
 * again at once, and one that goes LATER gets the same sign-in rather than a dead page. Both paths
 * release this device's push record, clear the session and tear down the drawer first, because the
 * drawer was wired with the old member's name and pills, and on a shared device neither that nor the
 * member's targeted notices may stay behind the sign-in.
 * A session that could not be DECIDED — the policy says `pending` because the sign-in reached no
 * answer: Firebase's start-up stalled, or the attempt failed transiently (the network, the reset check
 * unavailable, a rate limit, Firebase's internal error, an account or viewer the browser could not
 * shed) — is the one case that clears nothing (v24.61): the sign-in is shown over a kept session, and
 * a late-landing identity reloads the page into itself.
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
import { nameToEmail } from './auth-identity.js';
import { getSession, clearSession, releasePushForEndingHold, AUTH_KEY } from './session.js';
import { requirePage } from './auth-policy.js';
import { getAuthSnapshot } from './auth-state.js';
import { watchIdentityLoss } from './claim-retry.js';
import { resetNavPanel } from './nav-panel.js';
import { confirmDialog, whenHistorySettled } from './overlay.js';
import { writesInFlight } from './slow-save.js';

/** Set once a sign-out or a leave has been answered, so `warnOnUnload` does not ask a second time and
 *  `keepDraftWhenHidden` keeps nothing of the work the member chose to leave. */
let _leaving = false;
/** Set when the page reloads because the IDENTITY changed under it (`reloadIfRestoredForSomeoneElse`).
 *  That reload must not be stoppable — "Stay" kept a page up for somebody who had signed out in another
 *  tab (review, 15 Nov 2026) — but nobody answered a leave, so a draft is still kept (`_leaving` is not). */
let _identityReload = false;

/**
 * What every way off a page with unsaved work asks — the drawer, the About links and the header logos. A move WITHIN
 * the page asks `DISCARD_QUESTION` instead.
 *
 * IT SAYS THE WORK IS LOST, BECAUSE IT IS (confirm review, Nov 2026). An answered leave stands `keepDraftWhenHidden`
 * aside, so nothing is kept and nothing is offered back — while the same members are taught elsewhere that unsaved
 * work comes back (the Restore offer). It read "You have unsaved changes. Leave this page anyway?" under a plain
 * "Leave", where the same discard through sign-out was already `danger`. One cancel word, "Keep editing", everywhere.
 */
export const LEAVE_QUESTION = Object.freeze({
    title: 'Leave without saving?',
    message: 'Your unsaved changes on this page will be lost.',
    confirmLabel: 'Leave without saving',
    cancelLabel: 'Keep editing',
    danger: true,
});

/**
 * What a move WITHIN a page asks when it would throw unsaved work away — Admin's unsaved banner (another week,
 * This week, another member, the date field, a jump to a booking) and Overtime's other week or Back to the list.
 *
 * NOT THE LEAVE QUESTION (review, 22 Nov 2026). Those moves were asked "Leave without saving?", and the member
 * leaves nothing: they stay on the page, and only the changes go. So the question names what is lost, the
 * button says what it does, and the safe answer keeps the leave question's word, "Keep editing", and its place.
 */
export const DISCARD_QUESTION = Object.freeze({
    title: 'Discard your unsaved changes?',
    message: 'They will be lost if you move on now.',
    confirmLabel: 'Discard changes',
    cancelLabel: 'Keep editing',
    danger: true,
});

/**
 * Warn before the tab closes or navigates while there is unsaved work.
 * @param {() => boolean} isDirty
 */
export function warnOnUnload(isDirty) {
    hearAnsweredLeave();
    window.addEventListener('beforeunload', (e) => {
        if (!_leaving && !_identityReload && isDirty()) { e.preventDefault(); e.returnValue = ''; }
    });
}

/** Where the app draws links that leave the page: the drawer, and every page's About panel
 *  (`#iconLightbox`, about-lightbox.js) — Admin's "Calendar" (once "View staff roster") and "Staff & Admin Guide" went
 *  straight past the question for as long as it asked about the drawer alone (iPhone audit, Nov 2026). */
const LEAVING_ZONES = ['.nav-panel', '#iconLightbox'];

/**
 * Does following this link take the member off the page? Not a fragment of it (Report a bug is
 * `href="#"` until About opens), not mail (it is `mailto:` after), and not a `_blank` link, which
 * leaves this page where it is.
 * @param {HTMLAnchorElement} link
 * @returns {boolean}
 */
function leavesPage(link) {
    const href = link.getAttribute('href') ?? '';
    return !!href && !href.startsWith('#') && !/^mailto:/i.test(href) && link.target !== '_blank';
}

/**
 * Does this click send the link somewhere else rather than this tab — a new tab (Ctrl, or Cmd on a
 * Mac), a new window (Shift), a download (Alt), or a button other than the main one? Then it leaves
 * the page where it is, so there is nothing to ask; and "Leave" could not honour it anyway, because
 * the re-click carries no modifier and navigated THIS tab (routed from shared-ui, Nov 2026). The same
 * test as the drawer's own `plainClick`. A click with no `button` at all — an event built in code —
 * counts as the main button, so it is still asked about.
 * @param {MouseEvent} e
 * @returns {boolean}
 */
function opensElsewhere(e) {
    return (e.button ?? 0) !== 0 || !!(e.ctrlKey || e.metaKey || e.shiftKey || e.altKey);
}

/**
 * Ask before a DRAWER or ABOUT-PANEL LINK leaves the page with unsaved work (whole-app review, Oct
 * 2026; the About panel joined in the iPhone audit, Nov 2026). The browser's own unload prompt was the
 * only guard on those exits, and a phone never shows it, so a drawer pill discarded staged edits
 * without a word. Capture phase on `document`, so it runs before the link's own listeners and before
 * the drawer navigates; on "Leave" it clicks the link again with itself stood aside, so whatever the
 * page hangs on that link still runs (Admin's Calendar pill writes the month being edited first).
 * @param {() => boolean} isDirty
 */
export function askBeforeLeavingByDrawer(isDirty) {
    let passing = false;
    document.addEventListener('click', (e) => {
        if (passing || !isDirty() || opensElsewhere(e)) return;
        const link = /** @type {HTMLAnchorElement|null} */ (/** @type {Element} */ (e.target)?.closest?.('a[href]'));
        if (!link || !LEAVING_ZONES.some(zone => link.closest(zone)) || !leavesPage(link)) return;
        e.preventDefault();
        e.stopPropagation();
        confirmDialog({ ...LEAVE_QUESTION })
            .then((ok) => {
                if (!ok) return;
                _leaving = true;   // answered: the unload warning must not ask a second time
                passing = true;
                try { link.click(); } finally { passing = false; }
            });
    }, true);
}

/**
 * Ask before ONE control leaves the page with unsaved work, as a drawer link does — the header logo
 * on Operations, the one way off that page that did not ask (review, 15 Nov 2026): a phone never shows
 * the browser's own question. On "Leave" the unload warning stands aside, as it does for the drawer.
 * Admin's and Overtime's logos ask it too (confirm review, Nov 2026), so leaving a page is one
 * question wherever it starts.
 * @param {() => boolean} isDirty @param {() => void} go what leaving does
 * @returns {Promise<void>}
 */
export async function leaveAfterAsking(isDirty, go) {
    if (isDirty() && !(await confirmDialog({ ...LEAVE_QUESTION }))) return;
    leaveNow(go);
}

/**
 * Leave NOW, the question about the work answered: marked first, so the browser's "Leave site?" does not
 * ask a second time and `keepDraftWhenHidden` keeps nothing of the work the member chose to leave.
 * @param {() => void} go what leaving does
 */
function leaveNow(go) {
    _leaving = true;
    go();
}

/**
 * The event a question asked OUTSIDE this module sends once it has been answered with a leave — a
 * notification's "Open it" or "Reload" (sw-register.js). Neither half was told, so a desktop asked
 * "Leave site?" a second time and the next load offered back the work the member had chosen to leave
 * (confirm review, Nov 2026). An EVENT, not an import: sw-register.js is in modules that must never
 * reach the Firebase client (calendar-access-gate.test.mjs), and this module does.
 */
export const LEAVE_ANSWERED = 'myb-leave-answered';
/** Whether this page listens for `LEAVE_ANSWERED` yet — once, from whichever of the two needs it first. */
let _hearingAnsweredLeave = false;
function hearAnsweredLeave() {
    if (_hearingAnsweredLeave) return;
    _hearingAnsweredLeave = true;
    window.addEventListener(LEAVE_ANSWERED, () => { _leaving = true; });
}

/**
 * Keep a copy of unsaved work whenever the page is HIDDEN, for the exits nothing can ask about
 * (iPhone audit, Nov 2026): iOS discards a page it has put in the background, and a swipe back or
 * away asks nothing. `visibilitychange` is the event iOS sends before it can discard the page;
 * `pagehide` is the one a navigation sends. Hidden while dirty keeps the work; hidden while clean
 * forgets it — and so does a leave or sign-out the member has ANSWERED, because "Leave" and "Sign out
 * anyway" were both a discard. What a draft is and how it is offered: unsaved-draft.js.
 * @param {() => boolean} isDirty
 * @param {{ keep: () => void, forget: () => void }} slot  writes, or deletes, this page's draft
 */
export function keepDraftWhenHidden(isDirty, slot) {
    hearAnsweredLeave();
    const onHide = () => {
        try { if (!_leaving && isDirty()) slot.keep(); else slot.forget(); }
        catch (err) { console.error('[page-session] the unsaved-work draft could not be kept:', err); }
    };
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') onHide(); });
    window.addEventListener('pagehide', onHide);
}

/**
 * Run `fn` when the page comes back into view after at least `afterMs` out of it (iPhone audit, Nov
 * 2026). An installed app is not reloaded when it is reopened — iOS keeps it resident for days — so a
 * page that read its data once, or stamped "today" when it drew, goes on showing that. The time away
 * is measured on the wall clock from the moment the page was hidden, because that is the clock that
 * keeps running while the phone sleeps. A return through the back/forward cache counts too.
 * @param {number} afterMs
 * @param {(awayMs: number) => void} fn
 */
export function onReturnToPage(afterMs, fn) {
    /** @type {number|null} */ let hiddenAt = document.visibilityState === 'hidden' ? Date.now() : null;
    const back = () => {
        if (hiddenAt === null) return;
        const away = Date.now() - hiddenAt;
        hiddenAt = null;
        if (away >= afterMs) fn(away);
    };
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') hiddenAt ??= Date.now(); else back();
    });
    window.addEventListener('pagehide', () => { hiddenAt ??= Date.now(); });
    window.addEventListener('pageshow', (e) => { if (/** @type {PageTransitionEvent} */ (e).persisted) back(); });
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
        // A TITLE ON EACH, AND THE CONSEQUENCE STATED (confirm review, Nov 2026): untitled, the dialog's
        // accessible name was its whole message, and "Sign out anyway?" did not say the work is lost.
        if (writesInFlight() > 0) {
            // Both facts when both are true (v24.57, review) — one question must not hide the other.
            const dirty = isDirty();
            const alsoDirty = dirty ? ' Your unsaved changes on this page will be lost too.' : '';
            return confirmDialog({
                title: 'Sign out now?',
                message: `A change is still saving — if you sign out now it may be lost.${alsoDirty}`,
                confirmLabel: 'Sign out', cancelLabel: dirty ? 'Keep editing' : 'Stay signed in', danger: true,
            });
        }
        return !isDirty() || await confirmDialog({
            title: 'Sign out without saving?',
            message: 'You have unsaved changes. If you sign out now they will be lost.',
            confirmLabel: 'Sign out', cancelLabel: 'Keep editing', danger: true,
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
/** Who the page was built for (module state, so `rebaseRestoreGuard` can move it after an in-place
 *  sign-in), and who was signed in when it was last left. @type {string|null} */
let _builtFor = null;
/** @type {string|null} */
let _leftAs = null;

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
 * restored for the same member) — unless the page says it has been rebuilt for that member
 * (`rebaseRestoreGuard`). The other direction would show one member's data to another.
 */
export function reloadIfRestoredForSomeoneElse() {
    if (_restoreGuarded) return;
    _restoreGuarded = true;
    _builtFor = getSession()?.name ?? null;
    _leftAs = _builtFor;
    window.addEventListener('pagehide', () => { _leftAs = getSession()?.name ?? null; });
    window.addEventListener('pageshow', (e) => {
        const now = getSession()?.name ?? null;
        if (e.persisted && (now !== _builtFor || now !== _leftAs)) { _identityReload = true; window.location.reload(); }
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
        if (sessionName(e.oldValue) !== (getSession()?.name ?? null)) { _identityReload = true; window.location.reload(); }
    });
}

/**
 * The page has just been rebuilt, in place, for whoever is signed in NOW: from here on it is THEIR
 * page. Call it after an in-place sign-in has redrawn everything the page built for the previous
 * identity (its drawer, its data). Without it the guard keeps comparing with the identity the page
 * was LOADED for, and a restore for the member who signed in costs a needless reload (the harmless
 * case named on `reloadIfRestoredForSomeoneElse`). It never makes the guard let a DIFFERENT member
 * through: only the built-for identity moves, to the current one, and the identity at `pagehide` is
 * still recorded as the page is left, so a later sign-out or change still differs. Called before the
 * guard is installed it changes nothing: installing reads the session afresh.
 */
export function rebaseRestoreGuard() {
    _builtFor = getSession()?.name ?? null;
}

/** sessionStorage (one tab's journey): when this page's start-up stalled and the identity then landed
 *  late, the last time it reloaded for that. Local to this module — one reader, one writer. */
const LATE_IDENTITY_RELOAD = 'myb_late_identity_reload';
/** Set once this page load has allowed a reload with sessionStorage unusable — see below. */
let _reloadAllowedWithoutStorage = false;
/** Whether a late-identity reload may run now: not within two minutes of the last one. Stamps when it
 *  says yes. sessionStorage (one tab's journey), read directly in a try/catch — iOS private mode throws.
 *  Where it throws, one reload is still allowed rather than none — but only ONE per page load (review,
 *  Nov 2026): it said yes to every call, so the cap was no cap at all there. Memory cannot outlive the
 *  reload it allows, so across loads that tab is bounded only by each load's single late landing.
 *  @param {number} now @returns {boolean} */
export function lateReloadAllowed(now) {
    try {
        const last = parseInt(sessionStorage.getItem(LATE_IDENTITY_RELOAD) || '0', 10) || 0;
        if (now - last < LATE_RELOAD_GAP_MS) return false;
        sessionStorage.setItem(LATE_IDENTITY_RELOAD, String(now));
    } catch {
        if (_reloadAllowedWithoutStorage) return false;
        _reloadAllowedWithoutStorage = true;
    }
    return true;
}
/** Two minutes: longer than any start-up stall plus the SDK's own 30s lookup timeout, so a second
 *  landing inside it can only be the same stall again. */
export const LATE_RELOAD_GAP_MS = 120_000;

/** The member a stored session value names, or null. @param {string|null|undefined} raw */
function sessionName(raw) {
    try { return (raw && JSON.parse(raw)?.name) || null; } catch { return null; }
}

/** What the shared sign-in says once this page has signed the member out on this device. */
export const SIGNED_OUT_NOTICE = 'You’ve been signed out on this device. Sign in again to carry on.';

/**
 * Once the page's own Firebase session settles: sign in again now if it could not be confirmed, and
 * again later if the account goes mid-visit.
 * @param {{ page: string, pageLabel: string, member: string, established: Promise<any>|any,
 *           signIn?: () => void, about?: import('./login-overlay.js').LoginAbout|null }} opts
 *        `signIn` defaults to the shared in-place sign-in, reloading on success. That card is FOR
 *        `member` (their grade and name chosen, the password next) and, once this page has cleared the
 *        session, says so (`SIGNED_OUT_NOTICE`): a blank card asking for grade and name again read like
 *        a fault (review, Nov 2026). `about` is what it says the page is, for a page whose card at load
 *        carries one (Trains). A page that passes its own `signIn` words its own card.
 * @returns {Promise<void>}
 */
export function guardNamedSession({ page, pageLabel, member, established, signIn, about = null }) {
    // Loaded on demand: the Calendar and the Pay Calculator import this module for the sign-out
    // routines and never call this one, and the sign-in is 44 KB they would otherwise load at start.
    // Every page that DOES call it already has the module (it shows its own sign-in at load).
    /** @type {(signedOut: boolean) => void} */
    const showSignIn = signIn ? () => signIn() : (signedOut) => { import('./login-overlay.js')
        .then(({ initLoginOverlay }) => initLoginOverlay({ pageLabel, about, presetName: member,
            notice: signedOut ? SIGNED_OUT_NOTICE : '', onSuccess: () => window.location.reload() }))
        .catch((err) => { console.error('[page-session] sign-in could not load:', err); window.location.reload(); }); };
    // The sign-in waits for the reset's history step to land (v25.06): it pushes an entry of its own.
    // This device's push record goes FIRST, as at every other end of a member's hold (audit A1) — never
    // awaited, so the sign-in does not wait on it. The identity has usually gone already (that is why
    // the sign-in is back), so the release drops the browser subscription and the next send's 410
    // deletes the record — as on the Calendar after a reset refusal.
    const relogin = () => { releasePushForEndingHold(); clearSession(); resetNavPanel(); whenHistorySettled(() => showSignIn(true)); };
    // NOTHING IS KNOWN YET, SO NOTHING IS TAKEN AWAY (v24.61, iOS audit B1). `pending` here means the
    // sign-in reached no answer — Firebase's start-up stalled past its bound, or the attempt failed
    // transiently: a network error, the reset check unavailable, a rate limit, Firebase's internal
    // error, a shed that failed (`terminalAuthEvent`, session.js). The member has not been refused, so
    // the card does not say they were signed out. Keep the local session and the drawer, show the
    // sign-in — which can also sign them in, if they would rather not wait — and if the identity
    // this page belongs to lands late, reload into it rather than leave a page whose writes would fail.
    // ONE automatic reload per two minutes (24-hour review). On a connection that accepts and never
    // answers, the SDK gives up its own lookup after ~30s and emits the stored user anyway — so the
    // identity "lands late" on EVERY load, and an uncapped reload was a loop with the sign-in
    // flashing inside it. After the one reload the overlay stays, and it can still sign them in.
    const holdForLateIdentity = () => {
        showSignIn(false);
        const email = nameToEmail(member);
        const stop = onAuthStateChanged(auth, (/** @type {any} */ user) => {
            if (!user || user.isAnonymous || user.email !== email) return;
            stop();
            if (!lateReloadAllowed(Date.now())) return;
            window.location.reload();
        });
    };
    return Promise.resolve(established).then(() => {
        const { decision } = requirePage(getAuthSnapshot(), page);
        if (decision === 'login')   { relogin(); return; }
        if (decision === 'pending') { holdForLateIdentity(); return; }
        watchIdentityLoss({
            uid: auth.currentUser?.uid,
            watch: (cb) => onAuthStateChanged(auth, cb),
            stillLost: () => !auth.currentUser && getSession()?.name === member,
            onLost: relogin,
        });
    });
}
