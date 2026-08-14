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
 */

import { auth, signInWithCustomToken, signInAnonymously, signOut, setViewerPersistence, onAuthStateChanged } from './firebase-client.js';
import { getSession, clearSession, reconcileExpiredIdentity, ensureNamedSession } from './session.js';
import { CONFIG } from './roster-data.js';
import { isViewerUser, decideAccess, normalisePin, isCompletePin, classifyUnlockFailure, attemptBackoffMs, PIN_LENGTH, CALENDAR_VIEWER_CLAIM } from './calendar-access-core.js';

/** The exchange endpoint. Same region + project as every other MYB function. */
const UNLOCK_URL = 'https://europe-west2-myb-roster.cloudfunctions.net/unlockCalendarViewer';

/** How long to wait on the exchange before calling it a network failure. Generous — a cold start of
 *  a rarely-called function is a real several seconds, and timing out into "check the connection"
 *  on a working network is the more annoying of the two errors. */
const UNLOCK_TIMEOUT_MS = 15000;

/** @type {'named'|'viewer'|'open'|'none'} */
let _accessType = 'none';
/** @type {(() => void)|null} */
let _resolveAccess = null;
let _consecutiveFailures = 0;
/** @type {(() => void)|null} */
let _onGranted = null;
/** Runs on EVERY grant, where `_onGranted` runs once. @type {(() => void)|null} */
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
    try {
        // BOUNDED, like every other wait on this path (v20.45). `reconcileExpiredIdentity` awaits
        // the first auth emission with no timeout of its own, and it runs BEFORE `firstAuthUser`
        // below — so the 6-second ceiling that keeps a wedged auth layer from holding the Calendar
        // at a blank page sat behind an unbounded wait on the same emission, and could never fire.
        // The race leaves reconcile running in the background if it is merely slow: it is an
        // idempotent teardown, and the decision below reads ground truth either way.
        await Promise.race([
            reconcileExpiredIdentity({ preserveCalendarViewer: true }),
            new Promise(resolve => setTimeout(resolve, 6500)),
        ]);
    } catch { /* best effort — the decision below is made from ground truth either way */ }
    // `auth.currentUser` alone MISSES a cold restore: persistence being configured does not mean the
    // persisted user has loaded, and the first `onAuthStateChanged` emission is what delivers it.
    // Reading too early would report `none` for a member who is signed in and put the PIN in front
    // of them — the exact "distracting flash" this has to avoid.
    const user = auth.currentUser || await firstAuthUser();
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

/** Resolve the first `onAuthStateChanged` emission (the persisted-user restore), or null.
 *  Bounded, because a wedged auth layer must not hold the Calendar at a blank screen for ever —
 *  timing out here yields `none`, which shows the unlock panel, which is recoverable. */
function firstAuthUser() {
    return new Promise(resolve => {
        let done = false;
        const finish = (/** @type {any} */ u) => { if (!done) { done = true; resolve(u || null); } };
        const timer = setTimeout(() => finish(null), 6000);
        try {
            const off = onAuthStateChanged(auth, (/** @type {any} */ u) => {
                clearTimeout(timer); try { off(); } catch { /* noop */ } finish(u);
            }, () => { clearTimeout(timer); finish(null); });
        } catch { clearTimeout(timer); finish(null); }
    });
}

/** Commit an access decision exactly once, and let the Calendar start. */
function grant(/** @type {'named'|'viewer'|'open'} */ type) {
    _accessType = type;
    // A fresh session starts with a clean slate on the CLIENT backoff too. Without this, a member
    // who fumbled three times at boot, unlocked, and is re-locked hours later (PIN rotation) begins
    // their next attempt already one failure from the delay — punished for a mistake from a
    // different sitting. The server's window is authoritative and is not touched by this.
    _consecutiveFailures = 0;
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
    if (_onEveryGrant) { try { _onEveryGrant(); } catch (e) { console.error('[CalendarAccess] gate reopen failed', e); } }
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
    window.location.replace('./');
}

// ── The workspace gate ──────────────────────────────────────────────────────────────────────────

/** The Calendar workspace: everything that implies usable roster data. The header and the nav
 *  drawer are deliberately NOT in this list — the guides, the Huddle and the documents are reachable
 *  without Calendar access, and locking the whole app to read the Railcard guide would be absurd. */
const WORKSPACE_IDS = ['calendarControls', 'notifPrompt', 'payPeriodStrip', 'swipeHint', 'calendarDisplay', 'calendarLegend'];

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

// ── The unlock panel ────────────────────────────────────────────────────────────────────────────

/** The submit label, declared ONCE. It is written in two places — the initial markup and the
 *  restore after a failed attempt — and the second copy had already lost the arrow, so a member who
 *  mistyped got a subtly different button back from the one they pressed. */
const SUBMIT_LABEL = 'Unlock Calendar →';

/** @type {HTMLElement|null} */ let _panel = null;
/** @type {any} */ let _backoffTimer = null;
/** @type {any} */ let _skeletonTimer = null;

function hideLockPanel() {
    if (_panel) { _panel.remove(); _panel = null; }
    if (_backoffTimer) { clearTimeout(_backoffTimer); _backoffTimer = null; }
    if (_skeletonTimer) { clearTimeout(_skeletonTimer); _skeletonTimer = null; }
}

/** How long the decision may take before the page has to say something. Long enough that a normal
 *  boot — where access resolves in the same tick the workspace would have rendered — never flashes
 *  it, short enough that nobody stares at nothing. */
const SKELETON_AFTER_MS = 400;

/**
 * Say "working", while the access decision is still outstanding.
 *
 * ── THE HOLE THIS FILLS (v20.80) ────────────────────────────────────────────────────────────────
 *
 * The splash is dismissed by `calendar-app.js` at module-execution time — deliberately, because
 * leaving it up would trap a locked visitor behind a loading screen with no way out. But the access
 * decision resolves LATER, and between the two there is nothing on the page at all: a navy field, a
 * burger and a wordmark. MEASURED, with the auth restore held at 3s: splash down at ~700ms, the
 * card or the grid at ~3.6s, and 2.9 seconds of blank in between. It reads as a broken app, which
 * is a worse answer than the loading screen it replaced. `splash-watchdog.js` does not cover it
 * either — it stands down the moment the splash gets `.hidden`, which is exactly when this starts.
 *
 * It shows the SHAPE of a calendar and no data — no dates, no shift text, nothing from the roster
 * module — so it is safe in front of a visitor who may turn out to have no access at all. That is
 * why it is here rather than in the workspace: `calendar-app.js` may not run a single line until
 * access is granted, and this has to appear before that is known.
 *
 * It occupies `_panel`, so every existing teardown already removes it: `grant()` and both cards
 * call `hideLockPanel()` first.
 */
function showBootSkeleton() {
    // Nothing should be up when this fires — `hideLockPanel` owns the timer and every path that
    // answers the decision calls it — but replace rather than stack, like both cards do, so this can
    // never orphan a panel it did not build.
    hideLockPanel();
    const host = document.querySelector('.container') || document.body;
    if (!host) return;
    const el = document.createElement('section');
    el.id = 'calendarBooting';
    el.className = 'cal-boot';
    // Month bar, day-name row, then 42 cells — six weeks, the calendar's own worst case, so the
    // block does not resize when the real grid replaces it. The measurements in the CSS are the
    // REAL grid's, taken from a rendered calendar rather than guessed, so the swap is a fill-in
    // rather than a re-layout. `aria-hidden` because it is scenery: the live region above is what a
    // screen reader should hear, and 42 announced blanks is what it should not.
    el.innerHTML =
        '<p class="sr-only" role="status">Loading the roster…</p>' +
        '<div class="cal-boot-head" aria-hidden="true"></div>' +
        '<div class="cal-boot-days" aria-hidden="true">' + '<span></span>'.repeat(7) + '</div>' +
        '<div class="cal-boot-grid" aria-hidden="true">' + '<span class="cal-boot-cell"></span>'.repeat(42) + '</div>';
    host.appendChild(el);
    _panel = el;
}

/**
 * Build and show the staff-access panel.
 *
 * Deliberately NOT a lightbox. `createLightbox` is the app's modal grammar — backdrop, focus trap,
 * Escape, an Android Back entry — and every one of those is wrong here: there is nothing behind it
 * to go back to, Escape would have nowhere to dismiss to, and a trap on a screen with one field is
 * a cage. It is a CARD in the page, in the place the Calendar will appear, which is also what makes
 * the unlock feel like the page filling in rather than a dialog being satisfied.
 */
function showLockPanel() {
    hideLockPanel();   // replace, never stack — see showMemberPanel
    document.body.classList.add('calendar-locked');
    setWorkspaceHidden(true);

    // ── Warm the exchange while the member is still typing (v20.45) ─────────────────────────────
    //
    // `unlockCalendarViewer` sees a handful of calls a day, so the instance serving it is usually
    // COLD, and a cold start is the single largest number in the unlock chain — worth more than
    // every code path after it combined. The seconds a person spends reading this card and typing
    // four digits are exactly the seconds that start covers, so spend them: one fire-and-forget GET,
    // which the handler answers with a bare 405 before touching the throttle store, the secret or
    // any Firebase surface. Nothing is sent (no PIN — there isn't one yet), nothing is read from
    // the response, and a failure changes nothing (`catch` and move on) — the submit path neither
    // knows nor cares whether the warm-up happened.
    try { fetch(UNLOCK_URL, { method: 'GET', cache: 'no-store' }).catch(() => {}); }
    catch { /* fetch unavailable — the submit path is unaffected */ }

    // Falls back to <body>. `.container` has been there since the app was written, but the cost of
    // it being absent is not "the card is misplaced" — it is a navy page with no card, no calendar
    // and no way forward, on the app's front door. A misplaced card is recoverable; nothing is not.
    const host = document.querySelector('.container') || document.body;
    if (!host) return;

    const panel = document.createElement('section');
    panel.id = 'calendarLock';
    panel.className = 'cal-lock';
    panel.setAttribute('aria-labelledby', 'calLockTitle');
    // Mirrors `#loginCard`'s structure element for element (v20.14) — icon, app name, subtitle,
    // a left-aligned `.login-field` with its uppercase label and hint, the shared primary button,
    // the `.login-error` channel, then a quiet text link. Staff meet this exact shape on five other
    // pages; the PIN card is the sixth page's version of the same moment and should not be a
    // second, nearly-identical design. The classes are the login family's on purpose, the way
    // `#pwForceContent` reuses them — see the shared.css comment on the panel recipe.
    panel.innerHTML = `
        <div class="cal-lock-card">
            <img src="./icon-192.png" alt="" loading="eager">
            <div class="login-app-name">Marylebone Roster</div>
            <div class="login-subtitle">Calendar · Staff PIN</div>
            <form id="calLockForm" novalidate>
                <div class="login-field">
                    <label for="calLockPin">Staff PIN</label>
                    <input class="cal-lock-pin" id="calLockPin" name="staff-pin" type="password"
                           inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]*"
                           maxlength="${PIN_LENGTH}" enterkeyhint="go" spellcheck="false"
                           aria-describedby="calLockHint" autocapitalize="off">
                    <p class="login-hint" id="calLockHint">One code for everyone at Marylebone. It opens the live roster — including annual leave, absence and shift changes — for as long as this browser stays open.</p>
                </div>
                <div class="login-error" id="calLockMsg" role="status" aria-live="polite"></div>
                <button id="calLockSubmit" type="submit" disabled>${SUBMIT_LABEL}</button>
            </form>
            <button class="login-back cal-lock-alt" id="calLockSignIn" type="button">Sign in instead</button>
            <!-- The login family's footer treatment, and it answers a real question this screen
                 otherwise leaves hanging: a new starter opening the app for the first time has no
                 way to know the code or who holds it. "The admin" per the wording conventions —
                 access to the app is an app matter, not a rostering one. -->
            <p class="login-help">Don’t know the PIN? Ask the admin.</p>
        </div>`;
    host.appendChild(panel);
    _panel = panel;

    const form   = /** @type {HTMLFormElement} */ (panel.querySelector('#calLockForm'));
    const input  = /** @type {HTMLInputElement} */ (panel.querySelector('#calLockPin'));
    const submit = /** @type {HTMLButtonElement} */ (panel.querySelector('#calLockSubmit'));
    const msg    = /** @type {HTMLElement} */ (panel.querySelector('#calLockMsg'));
    const signIn = /** @type {HTMLButtonElement} */ (panel.querySelector('#calLockSignIn'));

    /** Write the one message channel. It wears `.login-error` — the app's established soft-red box —
     *  and is HIDDEN when empty (`.visible` is what shows it), so the card has no reserved blank
     *  line to leave a hole in the layout. A non-error message (the in-flight "Checking…") uses the
     *  same box in a neutral tint, so there is one live region rather than two competing ones.
     *  @param {string} text @param {boolean} isError */
    function say(text, isError) {
        // VISIBLE FIRST, then the text. The box is `display: none` when empty, and an element that
        // is not displayed is not in the accessibility tree — so writing the text while it is still
        // hidden means the live region never observes a change, and whether making it visible
        // afterwards announces anything is left to the screen reader. Setting the text while the
        // region IS in the tree is the only order that reliably announces. (axe cannot see this:
        // it checks that a live region exists, not that it ever spoke.)
        msg.classList.toggle('visible', !!text);
        msg.classList.toggle('cal-lock-msg--info', !!text && !isError);
        msg.textContent = text;
    }

    let _busy = false;

    // Digits only, always. Filtering on input rather than rejecting on submit means the field can
    // never hold something the member can see but the app will not accept.
    input.addEventListener('input', () => {
        const cleaned = normalisePin(input.value);
        if (cleaned !== input.value) input.value = cleaned;
        submit.disabled = !isCompletePin(cleaned) || _busy;
        if (msg.textContent) say('', false);
    });

    form.addEventListener('submit', async e => {
        e.preventDefault();
        const pin = normalisePin(input.value);
        if (!isCompletePin(pin) || _busy) return;
        _busy = true;
        submit.disabled = true;
        submit.textContent = 'Unlocking…';
        say('Checking the PIN…', false);

        const result = await unlockWithPin(pin);
        // Clear the field before anything else on every path, success included. A PIN left in a
        // form field on a shared PC is readable by the next person through devtools autofill, and
        // on failure a cleared field is also what the member wants — they are retyping it anyway.
        input.value = '';
        if (result.ok) return;   // the panel is being removed by grant(); leave it alone

        _consecutiveFailures++;
        _busy = false;
        submit.textContent = SUBMIT_LABEL;
        say(result.message, true);

        const wait = attemptBackoffMs(_consecutiveFailures);
        if (wait > 0) {
            submit.disabled = true;
            _backoffTimer = setTimeout(() => {
                _backoffTimer = null;
                submit.disabled = !isCompletePin(normalisePin(input.value));
            }, wait);
        } else {
            submit.disabled = true;   // the field is now empty
        }
        // Focus goes back to the field on every failure — the member's next action is always to
        // retype, and leaving focus on a disabled button strands a keyboard user with nowhere to go.
        input.focus();
    });

    // Reuses the shared member login overlay rather than duplicating a second sign-in. It injects
    // its own DOM and needs nothing from this page. On success it reloads, and the boot decision
    // then answers `named` — so there is no second code path for "signed in from the lock screen".
    signIn.addEventListener('click', async () => {
        const { initLoginOverlay } = await import('./login-overlay.js');
        initLoginOverlay({ pageLabel: 'the Calendar', onSuccess: () => window.location.reload() });
    });

    // Focus the field, but only on a device with a real keyboard. Autofocusing on a phone throws up
    // the on-screen keyboard over the explanation the member has not read yet.
    if (window.matchMedia && window.matchMedia('(pointer: fine)').matches) {
        try { input.focus(); } catch { /* noop */ }
    }
}

/**
 * The MEMBER's way back in — shown instead of the PIN card when a live local session has outlived
 * its Firebase identity.
 *
 * ── WHY THIS IS A SEPARATE SCREEN ───────────────────────────────────────────────────────────────
 *
 * `decideAccess` needs BOTH a local session and a restored Firebase user, and the commonest way to
 * hold one without the other is not a bug: iOS evicts IndexedDB after ~7 days of not opening the
 * PWA, so a member with a 60-day local session loses the identity behind it while still being, as
 * far as they and the app are concerned, signed in. Answering that with the staff PIN is wrong twice
 * over. It asks a signed-in member for a code they may not have, and it offers them a SHARED
 * capability — unlocking would leave them viewing the Calendar as an anonymous viewer with their own
 * name still in the drawer, and the first thing they tried to do on Admin would fail.
 *
 * So the ONE thing this screen does is get their own identity back. It tries silently first (see
 * `trySilentReauth` — for anyone still on the surname default that succeeds with nothing shown but a
 * flicker of the disabled button), and falls back to the app's real sign-in overlay. The PIN is
 * still reachable underneath, because a shared PC where somebody left a session behind is a real
 * situation and stranding the next person would be worse than an unnecessary link.
 *
 * @param {string} name
 */
function showMemberPanel(name) {
    // REPLACE, never early-return. The two cards are alternatives for the same slot, and "a panel is
    // already up" is not a reason to leave the WRONG one there — the PIN → member direction is
    // exactly what a re-lock followed by a fresh decision produces.
    hideLockPanel();
    document.body.classList.add('calendar-locked');
    setWorkspaceHidden(true);

    const host = document.querySelector('.container') || document.body;
    if (!host) return;

    const panel = document.createElement('section');
    panel.id = 'calendarLock';
    panel.className = 'cal-lock';
    // Same card, same ids for the button and the message channel, so both wear the styling the PIN
    // card already established — including `#calLockSubmit:disabled`, which is exactly the resting
    // look wanted while the silent attempt is in flight.
    panel.innerHTML = `
        <div class="cal-lock-card">
            <img src="./icon-192.png" alt="" loading="eager">
            <div class="login-app-name">Marylebone Roster</div>
            <div class="login-subtitle" id="calLockWho">Calendar</div>
            <p class="login-hint" id="calLockWhy" role="status" aria-live="polite">This device needs to sign you in again before it can show your roster.</p>
            <button id="calLockSubmit" type="button" disabled>Signing you in…</button>
            <button class="login-back cal-lock-alt" id="calLockPinInstead" type="button">Use the staff PIN instead</button>
        </div>`;
    host.appendChild(panel);
    _panel = panel;

    // NOTE: the explanation IS the live region. A .login-error box was tried here and looked exactly
    // like a disabled text field sitting above the button — on a card whose whole job is "sign in",
    // a faux input is the one thing it must not appear to have. One sentence that rewrites itself
    // carries both states and announces the change. (Kept out of the template literal above:
    // backticks inside it are a syntax error, which is how this went out broken once already.)
    const who    = /** @type {HTMLElement} */ (panel.querySelector('#calLockWho'));
    const why    = /** @type {HTMLElement} */ (panel.querySelector('#calLockWhy'));
    const submit = /** @type {HTMLButtonElement} */ (panel.querySelector('#calLockSubmit'));
    const pinAlt = /** @type {HTMLButtonElement} */ (panel.querySelector('#calLockPinInstead'));

    // textContent, not interpolation. The name comes from this device's own storage rather than any
    // remote source, so this is not a live injection route — but a panel built by string
    // concatenation on the app's front door is not the place to rely on where a value came from.
    who.textContent = `Calendar · ${name}`;

    submit.addEventListener('click', async () => {
        const { initLoginOverlay } = await import('./login-overlay.js');
        initLoginOverlay({ pageLabel: 'the Calendar', onSuccess: () => window.location.reload() });
    });

    // ── LEAVING A NAMED IDENTITY IS A SIGN-OUT, NOT A PANEL SWAP (v21.23, external review) ─────────
    //
    // This used to be `hideLockPanel(); showLockPanel();` — it changed the card and nothing else. But
    // the local session that named this card is the SAME one `calendar-app.js` already built the nav
    // drawer from, at module scope, before access is decided (deliberately, so a locked visitor still
    // has the drawer). So the next person at a shared PC unlocked with the staff PIN and got a
    // Calendar whose drawer still said "G. Miller", still offered Sign out, and still showed whatever
    // page pills that member's permissions earned — Operations and Links among them.
    //
    // No privilege travelled with it: those pages guard themselves, and the viewer token carries no
    // `name`/`admin`/`manager`/`linksDesigner` claim. What travelled was the previous person's NAME
    // and, readable off the pills, their ROLE — on the one screen in the app designed to be handed
    // between strangers.
    //
    // The remedy is the one the app already uses for exactly this transition, one line away in
    // `onSignOut`: drop the local session and reload. The reload is doing the work — every consumer
    // seeded from `getSession()` at module scope is rebuilt from nothing, which no in-place repaint
    // of this panel could achieve. `decideAccess` then sees no session and no identity and lands on
    // the PIN card, which is where the tap was going anyway.
    pinAlt.addEventListener('click', () => {
        clearSession();
        window.location.reload();
    });

    // The silent attempt. It runs AFTER the panel is on screen deliberately: awaiting it first would
    // hold the page blank for the length of a round trip, and this state is already the slow path.
    trySilentReauth(name).then(ok => {
        // The recovery routes can BOTH fire: a successful silent re-auth returns true and emits the
        // auth state `watchForLateNamedIdentity` is listening for. Granting twice is not harmless —
        // `_onEveryGrant` rebuilds the override gate — so whichever arrives second stands down. The
        // check and the call are synchronous, which is what makes that safe.
        if (ok) { if (_accessType === 'none') grant('named'); return; }   // grant() removes the panel
        if (!_panel || _panel !== panel) return;   // superseded (the PIN card, or a late grant)
        submit.disabled = false;
        submit.textContent = 'Sign in →';
        why.textContent = 'Enter your password to see your roster.';
    });
}

/**
 * Re-establish the member's own Firebase identity with nothing typed, if that is possible.
 *
 * `ensureNamedSession` with no password tries ONLY the derived surname (PASSWORD_PLAN.md §3.4), which
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
    _accessType = 'none';
    document.body.classList.remove('calendar-unlocked');
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
 * @param {{ onGranted: () => void, onEveryGrant?: (() => void)|null }} deps
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

    // Say something if the decision is slow (v20.80). Scheduled BEFORE the await, cleared by every
    // path out of it — `grant()` and both cards call `hideLockPanel()`, which owns the timer.
    _skeletonTimer = setTimeout(() => { _skeletonTimer = null; showBootSkeleton(); }, SKELETON_AFTER_MS);

    /** @type {'named'|'viewer'|'open'|'none'} */
    let type;
    try { type = await resolveAccess(); }
    catch (e) { console.error('[CalendarAccess] decision failed', e); type = 'none'; }

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
    if (held?.name) showMemberPanel(held.name);
    else showLockPanel();
    return 'none';
}
