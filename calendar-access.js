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

import { auth, signInWithCustomToken, signOut, setViewerPersistence, onAuthStateChanged } from './firebase-client.js';
import { getSession, reconcileExpiredIdentity } from './session.js';
import { CONFIG } from './roster-data.js';
import { isViewerUser, decideAccess, normalisePin, isCompletePin, classifyUnlockFailure, attemptBackoffMs, PIN_LENGTH, CALENDAR_VIEWER_CLAIM } from './calendar-access-core.js';

/** The exchange endpoint. Same region + project as every other MYB function. */
const UNLOCK_URL = 'https://europe-west2-myb-roster.cloudfunctions.net/unlockCalendarViewer';

/** How long to wait on the exchange before calling it a network failure. Generous — a cold start of
 *  a rarely-called function is a real several seconds, and timing out into "check the connection"
 *  on a working network is the more annoying of the two errors. */
const UNLOCK_TIMEOUT_MS = 15000;

/** @type {'named'|'viewer'|'none'} */
let _accessType = 'none';
/** @type {(() => void)|null} */
let _resolveAccess = null;
let _consecutiveFailures = 0;
/** @type {(() => void)|null} */
let _onGranted = null;

/** Resolves the FIRST time Calendar access is granted, and never rejects.
 *  Never-rejecting is deliberate: every consumer uses it as a gate, and a rejection would have each
 *  of them needing its own catch — one missed catch would then be an unhandled rejection on the
 *  app's start page. Access that is never granted simply never resolves, and the locked UI is the
 *  user-visible half of that. */
export const calendarAccessReady = /** @type {Promise<void>} */ (new Promise(resolve => { _resolveAccess = () => resolve(); }));

/** @returns {'named'|'viewer'|'none'} the access this browser currently holds. */
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
        await reconcileExpiredIdentity({ preserveCalendarViewer: true });
    } catch { /* best effort — the decision below is made from ground truth either way */ }
    // `auth.currentUser` alone MISSES a cold restore: persistence being configured does not mean the
    // persisted user has loaded, and the first `onAuthStateChanged` emission is what delivers it.
    // Reading too early would report `none` for a member who is signed in and put the PIN in front
    // of them — the exact "distracting flash" this has to avoid.
    const user = auth.currentUser || await firstAuthUser();
    return decideAccess({ session: getSession(), firebaseUser: user });
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
function grant(/** @type {'named'|'viewer'} */ type) {
    _accessType = type;
    document.body.classList.remove('calendar-locked');
    document.body.classList.add('calendar-unlocked');
    hideLockPanel();
    setWorkspaceHidden(false);
    if (_onGranted) { const fn = _onGranted; _onGranted = null; try { fn(); } catch (e) { console.error('[CalendarAccess] start failed', e); } }
    if (_resolveAccess) { const r = _resolveAccess; _resolveAccess = null; r(); }
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
        if (auth.currentUser) { try { await signOut(auth); } catch { /* best effort */ } }
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
    try { await signOut(auth); } catch { /* best effort — the reload re-decides from ground truth */ }
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

function hideLockPanel() {
    if (_panel) { _panel.remove(); _panel = null; }
    if (_backoffTimer) { clearTimeout(_backoffTimer); _backoffTimer = null; }
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
    if (_panel) return;
    document.body.classList.add('calendar-locked');
    setWorkspaceHidden(true);

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
            <!-- The login card's the login card footer, and it answers a real question this screen
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
 * Re-lock a Calendar whose access has gone while it was open, and say why.
 *
 * Called by the sync chip when a read fails with `permission-denied` — which means the session
 * expired or was revoked, NOT that the network is poor. Those two need different words: an endless
 * "couldn't update, tap to retry" against an expired session is a loop the member cannot win, and
 * they would reasonably conclude the app is broken.
 */
export function handleAccessLost() {
    if (_accessType === 'none') return;
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
 * @param {{ onGranted: () => void }} deps  onGranted runs ONCE, the first time access is granted.
 *   It is how `calendar-app.js` defers every piece of Calendar initialisation — the member
 *   dropdown, the render, the fetch, the swipe handler — so that none of it exists while locked.
 * @returns {Promise<'named'|'viewer'|'none'>}
 */
export async function initCalendarAccess({ onGranted }) {
    _onGranted = onGranted;
    // Hide the workspace SYNCHRONOUSLY, before any await. The decision below is asynchronous, and
    // between here and there the browser paints — so leaving the workspace visible would flash an
    // empty Calendar shell at a member who is about to be shown their roster, and worse, would show
    // it to somebody who is about to be shown the PIN.
    setWorkspaceHidden(true);
    document.body.classList.add('calendar-locked');

    /** @type {'named'|'viewer'|'none'} */
    let type;
    try { type = await resolveAccess(); }
    catch (e) { console.error('[CalendarAccess] decision failed', e); type = 'none'; }

    if (type === 'none' && CONFIG.CALENDAR_PIN_ACCESS === false) {
        // Kill switch. If the PIN exchange is ever broken in production, flipping this in
        // roster-data.js reopens the Calendar to anyone with a named session and leaves everyone
        // else on the panel — it does NOT re-open override reads, which are the server's decision.
        // Present so the client half can be stood down without a rules rollback.
        console.warn('[CalendarAccess] PIN access disabled by config');
    }

    if (type === 'named' || type === 'viewer') { grant(type); return type; }
    showLockPanel();
    return 'none';
}
