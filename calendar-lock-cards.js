// @ts-check
/**
 * calendar-lock-cards.js — the three cards that can stand where the Calendar goes.
 *
 * Owns: the member SIGN-IN card (the front door), the staff-PIN card behind it, the member's
 *   COME BACK card for a session that outlived its identity — their markup, their wiring, the
 *   unlock form's failure backoff, and taking whichever is up back off the page.
 * Does NOT own: the access DECISION, the token exchange, persistence, or the claim check. Every one
 *   of those stays in `calendar-access.js` and arrives here as an injected function.
 * Edit here for: what a card says, what its controls do, which card follows which.
 *
 * ── WHY IT IS ITS OWN MODULE (v23.54) ──────────────────────────────────────────────────────────
 *
 * `calendar-access.js` said so itself. Its header's "Does NOT own" line already read *"any
 * rendering"* — while about three hundred lines of the file, near a third of it, were card markup
 * and event wiring. A file whose stated boundary and contents disagree is one an editor will be
 * wrong about, and it had reached its ratchet cap with two lines to spare.
 *
 * This is a SPLIT, not an extraction: no rule comes out, because the rules were never here. The
 * gate DECIDES and this DRAWS, and the split is along the line the gate's own header had already
 * drawn.
 *
 * ── THE SECURITY PROPERTIES DID NOT MOVE, AND THAT IS THE POINT ────────────────────────────────
 *
 * `calendar-access.js` names two things as the security model — the persistence ORDER (sign the
 * viewer out before switching stores, or it migrates into IndexedDB and survives the browser
 * closing) and the claim VERIFICATION (a token is not trusted for what it says on the tin).
 * Neither is here. What is here is a form that collects four digits and hands them to an injected
 * `unlockWithPin`; it never learns, stores, logs or compares a PIN, and it cannot grant anything.
 *
 * ── THE FOUR THINGS AN EDIT CAN SILENTLY BREAK ─────────────────────────────────────────────────
 *
 *   1. A CARD REPLACES, IT NEVER STACKS — and the SLOT is what guarantees it, not the calls here.
 *      `mountLockCard` calls `unmountLockCard` itself, so mounting anything removes what was up.
 *      Deleting `hideLockPanel()` from an entry point therefore breaks nothing about stacking; what
 *      it breaks is the PIN card's BACKOFF TIMER, which the slot knows nothing about and which
 *      would otherwise re-enable a submit button on a card that has gone. (Stated the other way
 *      round when this module was written, and the mutation that was supposed to prove the rule
 *      passed instead — the code was right and the header was wrong.) The rule itself still holds:
 *      "a panel is already up" is never a reason to leave the WRONG one there, and the PIN → member
 *      direction is exactly what a re-lock followed by a fresh decision produces.
 *   2. THE SIGN-IN CARD MUST NOT MOUNT OVER A GRANTED CALENDAR. It awaits a dynamic import, and
 *      access can arrive while that is in flight (the late-identity watcher, a silent re-auth), so
 *      it re-reads `getAccessType()` afterwards and gives up if the answer changed.
 *   3. LEAVING A NAMED IDENTITY IS A SIGN-OUT, NOT A PANEL SWAP. The member card's "use the staff
 *      PIN instead" clears the session and reloads; the argument, and the leak it fixed, are beside
 *      the handler.
 *   4. A FAILED UNLOCK CLEARS THE FIELD AND RETURNS FOCUS TO IT. On a shared PC a PIN left in a
 *      form field is readable by the next person, and focus parked on a disabled button strands a
 *      keyboard user.
 *
 * Tested through `calendar-access.test.mjs` (which drives these from `initCalendarAccess`, the real
 * entry point, not from the builders) and `e2e/calendar-pin.spec.js`.
 */

import { clearSession } from './session.js';
import { normalisePin, isCompletePin, attemptBackoffMs, PIN_LENGTH } from './calendar-access-core.js';
import { mountLockCard, unmountLockCard } from './calendar-lock-slot.js';

/** The hash that asks for the staff-PIN card FIRST (see calendar-access.js's module header). Read
 *  once at boot and removed from the address bar, so it is never carried into a member's session or
 *  a bookmark made afterwards. Declared here because the member card WRITES it; the boot reads it
 *  back from `calendar-access.js`, which imports it from here. */
export const PIN_FIRST_HASH = '#staff-pin';

/**
 * Wire the cards to their collaborators. Called ONCE, at module scope in `calendar-access.js`, so
 * the deps are in place long before any card can be shown. Injected rather than imported because
 * the gate imports this module: reaching back for them would be a cycle, and `import-graph.test.mjs`
 * refuses one.
 *
 * @param {object} deps
 * @param {(pin: string) => Promise<{ok: boolean, kind?: string, message?: string}>} deps.unlockWithPin
 *   The exchange. It owns the network call, the persistence switch and the claim check; this module
 *   only reads `ok` and `message`.
 * @param {() => string} deps.getAccessType  Asked LIVE, never captured — see rule 2 in the header.
 * @param {(hidden: boolean) => void} deps.setWorkspaceHidden  The gate's own workspace switch.
 * @param {string} deps.unlockUrl  Warmed with a bare GET while the member types (see below).
 */
export function initLockCards(deps) { _deps = deps; }

/** @type {any} */
let _deps = null;

/** Consecutive failed PIN attempts on this page load, which is what `attemptBackoffMs` reads. Reset
 *  by the gate on a grant. */
let _consecutiveFailures = 0;

/** The gate calls this on every grant — a fresh unlock must not inherit the last one's backoff. */
export function resetUnlockFailures() { _consecutiveFailures = 0; }

/** The submit label, declared ONCE. It is written in two places — the initial markup and the
 *  restore after a failed attempt — and the second copy had already lost the arrow, so a member who
 *  mistyped got a subtly different button back from the one they pressed. */
const SUBMIT_LABEL = 'Unlock Calendar →';

/** @type {any} */ let _backoffTimer = null;

/** Take whatever card is up off the page. The slot owns the element and the skeleton timer
 *  (calendar-lock-slot.js); the PIN card's backoff timer is this module's and is cleared here. */
export function hideLockPanel() {
    unmountLockCard();
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
export function showLockPanel() {
    hideLockPanel();   // replace, never stack — see showMemberPanel
    document.body.classList.add('calendar-locked');
    _deps.setWorkspaceHidden(true);

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
    try { fetch(_deps.unlockUrl, { method: 'GET', cache: 'no-store' }).catch(() => {}); }
    catch { /* fetch unavailable — the submit path is unaffected */ }

    // Mirrors `#loginCard`'s structure element for element (v20.14) — icon, app name, subtitle,
    // a left-aligned `.login-field` with its uppercase label and hint, the shared primary button,
    // the `.login-error` channel, then a quiet text link. Staff meet this exact shape on five other
    // pages; the PIN card is the sixth page's version of the same moment and should not be a
    // second, nearly-identical design. The classes are the login family's on purpose, the way
    // `#pwForceContent` reuses them — see the shared.css comment on the panel recipe.
    const panel = mountLockCard({ labelledBy: 'calLockTitle', html: `
        <div class="cal-lock-card">
            <img src="./icon-192.png" alt="" loading="eager">
            <div class="login-app-name">Marylebone Roster</div>
            <div class="login-subtitle" id="calLockTitle">Calendar · Staff PIN</div>
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
            <button class="login-back" id="calLockSignIn" type="button">Sign in instead</button>
            <!-- The login family's footer treatment, and it answers a real question this screen
                 otherwise leaves hanging: a new starter opening the app for the first time has no
                 way to know the code or who holds it. "The admin" per the wording conventions —
                 access to the app is an app matter, not a rostering one. -->
            <p class="login-help">Don’t know the PIN? Ask the admin.</p>
        </div>` });
    if (!panel) return;

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

        const result = await _deps.unlockWithPin(pin);
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

    // Back to the front door — the sign-in card, in place. Before v23.19 this opened the fixed
    // login overlay OVER the PIN card; now the two cards are alternatives for one slot.
    signIn.addEventListener('click', () => { showSignInPanel().catch(() => {}); });

    // Focus the field, but only on a device with a real keyboard. Autofocusing on a phone throws up
    // the on-screen keyboard over the explanation the member has not read yet.
    if (window.matchMedia && window.matchMedia('(pointer: fine)').matches) {
        try { input.focus(); } catch { /* noop */ }
    }
}

/**
 * The FRONT DOOR (v23.19): the member sign-in card, for a browser that holds nothing.
 *
 * It is the shared `login-overlay.js` card mounted INLINE in the lock slot — the same grade / name /
 * password form, the same sign-in core, the same lockout and reset request as the five sub-pages —
 * with the modal behaviours left out (no scroll lock, no focus trap, no Escape-to-roster: the roster
 * is this page, and the drawer beside the card must stay reachable). One sign-in mounted two ways,
 * rather than a second card written for the Calendar that would drift from the first.
 *
 * On success it RELOADS, and the boot decision then answers `named` — so there is no second code
 * path for "signed in from the front door", exactly as there was none for "signed in from the PIN
 * card's link". `#loginCard`'s recipe is shared with `.cal-lock-card` in shared.css, so the two
 * cards this slot can show are the same size, in the same place, in the same family.
 *
 * @param {string} [notice]  One line under the subtitle saying why the card is up, when the reason
 *   is not "you have not signed in" — an expired session, say.
 */
export async function showSignInPanel(notice = '') {
    // Hide the workspace NOW (the access-lost path arrives with a Calendar on screen) but take
    // nothing else down until the card can replace it: v23.19 emptied the slot BEFORE the fetch,
    // so a slow first visit saw a blank page where the PIN card used to draw at once. Whatever is
    // up stays up meanwhile — the skeleton (or its armed timer), or the PIN card on a swap.
    document.body.classList.add('calendar-locked');
    _deps.setWorkspaceHidden(true);
    /** @type {typeof import('./login-overlay.js')} */ let mod;
    // No module (a first visit on a connection that drops mid-boot) must still leave a DOOR: the
    // PIN card needs nothing fetched, so fall back to it.
    try { mod = await import('./login-overlay.js'); }
    catch { if (_deps.getAccessType() === 'none') showLockPanel(); return; }
    // Access may have arrived while the module loaded (the late-identity watcher, a silent
    // re-auth). A card mounted over a granted Calendar is the one outcome this must not have.
    if (_deps.getAccessType() !== 'none') return;
    const panel = mountLockCard({ labelledBy: 'loginSubtitle' });
    if (!panel) return;
    const { initLoginOverlay } = mod;
    initLoginOverlay({
        pageLabel: 'Calendar',
        onSuccess: () => window.location.reload(),
        host: panel,
        notice,
        alternative: {
            label: 'Use the staff PIN instead',
            // Who the PIN is FOR, said on the card that leads with the alternative to it — otherwise
            // a visiting colleague with no account reads a sign-in form and reasonably concludes the
            // app is not for them. "Visiting or agency staff": the audience the owner named.
            hint: 'Visiting or agency staff, or no password yet? The staff PIN opens the roster, the Daily Huddle and the guides.',
            onSelect: () => showLockPanel(),
        },
    });
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
 * So the ONE thing this screen does is get their own identity back, through the app's real sign-in
 * overlay. The SILENT attempt no longer lives here (v21.62): the boot path runs `trySilentReauth`
 * behind the skeleton BEFORE this card exists, so by the time it is built, silence has already
 * failed (or is hanging past its defer bound) and the card renders immediately actionable — no
 * disabled "Signing you in…" limbo state. The PIN is still reachable underneath, because a shared
 * PC where somebody left a session behind is a real situation and stranding the next person would
 * be worse than an unnecessary link.
 *
 * @param {string} name
 * @param {string} [why]  The explanation line. Defaults to the evicted-identity case; `handleAccessLost`
 *   passes the expired-session one.
 */
export function showMemberPanel(name, why = 'This device needs to sign you in again before it can show your roster. Enter your password to see it.') {
    // REPLACE, never early-return. The cards are alternatives for the same slot, and "a panel is
    // already up" is not a reason to leave the WRONG one there — the PIN → member direction is
    // exactly what a re-lock followed by a fresh decision produces.
    hideLockPanel();
    document.body.classList.add('calendar-locked');
    _deps.setWorkspaceHidden(true);

    // Same card, same ids for the button and the message channel, so both wear the styling the PIN
    // card already established — including `#calLockSubmit:disabled`, which is exactly the resting
    // look wanted while the silent attempt is in flight.
    const panel = mountLockCard({ labelledBy: 'calLockWho', html: `
        <div class="cal-lock-card">
            <img src="./icon-192.png" alt="" loading="eager">
            <div class="login-app-name">Marylebone Roster</div>
            <div class="login-subtitle" id="calLockWho">Calendar</div>
            <p class="login-hint" id="calLockWhy" role="status" aria-live="polite"></p>
            <button id="calLockSubmit" type="button">Sign in →</button>
            <button class="login-back" id="calLockPinInstead" type="button">Use the staff PIN instead</button>
        </div>` });
    if (!panel) return;

    // NOTE: the explanation keeps its `role="status"` live region even though the card now renders
    // in its final state (v21.62 — the waiting the two-state version represented happens behind the
    // skeleton before this card exists). A .login-error box was tried here once and looked exactly
    // like a disabled text field sitting above the button — on a card whose whole job is "sign in",
    // a faux input is the one thing it must not appear to have.
    const who    = /** @type {HTMLElement} */ (panel.querySelector('#calLockWho'));
    const submit = /** @type {HTMLButtonElement} */ (panel.querySelector('#calLockSubmit'));
    const pinAlt = /** @type {HTMLButtonElement} */ (panel.querySelector('#calLockPinInstead'));

    // textContent, not interpolation. The name comes from this device's own storage rather than any
    // remote source, so this is not a live injection route — but a panel built by string
    // concatenation on the app's front door is not the place to rely on where a value came from.
    who.textContent = `Calendar · ${name}`;
    const whyEl = /** @type {HTMLElement|null} */ (panel.querySelector('#calLockWhy'));
    if (whyEl) whyEl.textContent = why;

    submit.addEventListener('click', async () => {
        const { initLoginOverlay } = await import('./login-overlay.js');
        // The card's heading already names them; the form should not ask again (v23.58). The
        // overlay pre-selects grade and name and lands on the password field. `presetName` is a
        // convenience the overlay is free to ignore — it never widens who may sign in.
        initLoginOverlay({ pageLabel: 'the Calendar', onSuccess: () => window.location.reload(), presetName: name });
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
    // of this panel could achieve. `decideAccess` then sees no session and no identity. Since
    // v23.19 that lands on the SIGN-IN card, so the reload carries `#staff-pin` — the one hash the
    // boot reads — and the tap still lands where it was going.
    pinAlt.addEventListener('click', () => {
        clearSession();
        window.location.hash = PIN_FIRST_HASH;
        window.location.reload();
    });
}
