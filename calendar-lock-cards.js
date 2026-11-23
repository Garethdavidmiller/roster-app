// @ts-check
/**
 * calendar-lock-cards.js — the cards that can stand where the Calendar goes.
 *
 * Owns: the member SIGN-IN card (the front door), the member's COME BACK card for a session that
 *   outlived its identity, and the front door's fallback when its form cannot load — their markup,
 *   their wiring, and taking whichever is up back off the page.
 * Does NOT own: the access DECISION, the grant, or the sign-in itself. The first two stay in
 *   `calendar-access.js` and arrive here as injected functions; the third is `login-overlay.js`'s.
 * Edit here for: what a card says, what its controls do, which card follows which.
 *
 * ── WHY IT IS ITS OWN MODULE (v23.54) ──────────────────────────────────────────────────────────
 *
 * `calendar-access.js` said so itself: its header's "Does NOT own" line read *"any rendering"* while
 * near a third of the file was card markup and event wiring. The gate DECIDES and this DRAWS, along
 * the line the gate's own header had already drawn.
 *
 * ── THE STAFF PIN IS RETIRED (owner, 23 Nov 2026) ──────────────────────────────────────────────
 *
 * The PIN card, "Use the staff PIN instead" and the member card's "Sign out and use the staff PIN"
 * are gone with the PIN: a member's own sign-in is the only way in. A device whose leftover PIN
 * session the gate's teardown has just signed out sees ONE line about it on the sign-in card
 * (login-overlay.js → `sayStaffPinEnded`, staff-pin-ended.js), and nothing here offers a PIN box.
 *
 * ── THE THREE THINGS AN EDIT CAN SILENTLY BREAK ────────────────────────────────────────────────
 *
 *   1. A CARD REPLACES, IT NEVER STACKS — and the SLOT is what guarantees it (`mountLockCard` calls
 *      `unmountLockCard` itself). "A panel is already up" is never a reason to leave the WRONG one
 *      there: the sign-in → member direction is exactly what a re-lock followed by a fresh decision
 *      produces.
 *   2. THE SIGN-IN CARD MUST NOT MOUNT OVER A GRANTED CALENDAR. It awaits a dynamic import, and
 *      access can arrive while that is in flight (the late-identity watcher, a silent re-auth), so
 *      it re-reads `getAccessType()` afterwards and gives up if the answer changed.
 *   3. THE FRONT DOOR ALWAYS LEAVES A WAY FORWARD. When its form's module cannot load (a first visit
 *      on a connection that drops mid-boot), a short card says so and offers a reload
 *      (`showSignInUnavailable`) — never an empty slot. It was the PIN card until the PIN went.
 *
 * Tested through `calendar-access.test.mjs` (which drives these from `initCalendarAccess`, the real
 * entry point, not from the builders) and `e2e/calendar-pin.spec.js` (whose PIN half the e2e pass removes).
 */

import { mountLockCard, unmountLockCard } from './calendar-lock-slot.js';
import { speakAfterMount } from './status-text.js';
import { lazyImport } from './sw-register.js';

/**
 * Wire the cards to their collaborators. Called ONCE, at module scope in `calendar-access.js`, so
 * the deps are in place long before any card can be shown. Injected rather than imported because
 * the gate imports this module: reaching back for them would be a cycle, and `import-graph.test.mjs`
 * refuses one.
 *
 * @param {object} deps
 * @param {() => string} deps.getAccessType  Asked LIVE, never captured — see rule 2 in the header.
 * @param {(hidden: boolean) => void} deps.setWorkspaceHidden  The gate's own workspace switch.
 * @param {() => void} [deps.onAwaitingInput]  Told when a card that asks somebody to type appears,
 *   so the speed figures leave the typing out (perf-reporter.js `markAwaitingInput`). Injected, so
 *   this module imports no telemetry.
 * @param {() => unknown} deps.finishSignIn  What a sign-in on either card does once it has succeeded:
 *   grant in place, or reload (calendar-access.js decides which). Injected for the same reason.
 */
export function initLockCards(deps) { _deps = deps; }

/** @type {any} */
let _deps = null;

/** The sign-in form's module once the member card has fetched it, so "Sign in →" can open the form
 *  inside the tap (`showMemberPanel`). Null until then, and after a failed fetch.
 *  @type {typeof import('./login-overlay.js')|null} */
let _signInForm = null;

/** Take whatever card is up off the page. The slot owns the element and the skeleton timer
 *  (calendar-lock-slot.js). */
export function hideLockPanel() {
    unmountLockCard();
}

/**
 * Is a sign-in form's OWN attempt in flight — the round trip after "Sign in" was pressed? The form
 * marks its Back link busy for exactly that window (login-overlay.js), and its success then calls
 * `finishSignIn`, which grants for itself: anything else that would grant meanwhile stands down.
 * @returns {boolean}
 */
export function signInInFlight() {
    const form = document.getElementById('loginOverlay');
    return !!form && !!form.querySelector('.login-back--busy');
}

/** How long `afterSignInSettles` waits at most. The attempt it waits on is itself bounded (an 8s
 *  sign-in, then `finishSignIn`), so this is only a backstop for a form that never clears. */
const SIGN_IN_SETTLE_LIMIT_MS = 60_000;

/**
 * Run `fn` once, after the form's own sign-in has settled — success or failure. For a grant that
 * stood down for that sign-in (`signInInFlight`): standing down FOR GOOD left a live identity locked
 * out when the sign-in then failed, with no further auth event to look again (review, 20 Nov 2026).
 * `fn` re-checks for itself; on a success the sign-in has already granted, and it does nothing.
 * @param {() => void} fn
 */
export function afterSignInSettles(fn) {
    const started = Date.now();
    const look = () => {
        if (signInInFlight() && Date.now() - started < SIGN_IN_SETTLE_LIMIT_MS) { setTimeout(look, 200); return; }
        fn();
    };
    setTimeout(look, 200);
}

/**
 * Take the come-back card's FULL-SCREEN sign-in form down, for a grant (cal-data-9, 10 Nov 2026).
 * The form is appended to <body>, not the slot, so a grant that landed while it was open — a slow
 * identity restore, the silent sign-in — took the card away and left the form asking for a password
 * over a Calendar already granted and built. The front door's INLINE card is in the slot and goes
 * with it. A form whose OWN sign-in is in flight is left, unless that sign-in is the one granting
 * (`evenMidSignIn`, from `finishSignIn`): its success decides what follows, and a reload — the other
 * answer — takes the form with the page.
 * @param {{ evenMidSignIn?: boolean }} [opts]
 */
export function dismissSignInForm({ evenMidSignIn = false } = {}) {
    const form = document.getElementById('loginOverlay');
    if (!form || form.classList.contains('login-overlay--inline') || (!evenMidSignIn && signInInFlight())) return;
    _signInForm?.dismissLoginOverlay();
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
 * On success it hands over to `finishSignIn` (calendar-access.js), which grants in place on a page
 * that has never been granted, and otherwise reloads so the boot decides — either way through the
 * one grant the boot uses, so there is no second code path for "signed in from the front door".
 * `#loginCard`'s recipe is shared with `.cal-lock-card` in shared.css, so the cards this slot can show
 * are the same size, in the same place, in the same family.
 *
 * It has no alternative beneath it any more: "Use the staff PIN instead" went with the PIN (owner,
 * 23 Nov 2026). The card says the PIN has been retired, once, on a device the gate's teardown has
 * just taken a PIN session from — the form listens for that itself (login-overlay.js).
 *
 * @param {string} [notice]  One line under the subtitle saying why the card is up, when the reason
 *   is not "you have not signed in" — an expired session, say.
 */
export async function showSignInPanel(notice = '') {
    // Hide the workspace NOW (the access-lost path arrives with a Calendar on screen) but take
    // nothing else down until the card can replace it: v23.19 emptied the slot BEFORE the fetch,
    // so a slow first visit saw a blank page. Whatever is up stays up meanwhile — the skeleton (or its
    // armed timer), or the member's stored roster.
    document.body.classList.add('calendar-locked');
    _deps.setWorkspaceHidden(true);
    /** @type {typeof import('./login-overlay.js')} */ let mod;
    // No module (a first visit on a connection that drops mid-boot) must still leave a DOOR — rule 3.
    try { mod = await lazyImport(() => import('./login-overlay.js')); }
    catch { if (_deps.getAccessType() === 'none') showSignInUnavailable(); return; }
    // Access may have arrived while the module loaded (the late-identity watcher, a silent
    // re-auth). A card mounted over a granted Calendar is the one outcome this must not have.
    if (_deps.getAccessType() !== 'none') return;
    const panel = mountLockCard({ labelledBy: 'loginSubtitle' });
    if (!panel) return;
    const { initLoginOverlay } = mod;
    initLoginOverlay({
        pageLabel: 'Calendar',
        onSuccess: () => { _deps.finishSignIn(); },
        host: panel,
        notice,
    });
}

/** The fallback card's words, declared once so the unit suite reads them rather than a copy. */
export const SIGN_IN_UNAVAILABLE_LINE = 'The sign-in form could not load. Check your connection and try again.';

/**
 * The front door's FALLBACK: the sign-in form's module could not load (rule 3 in the header). Until
 * the staff PIN was retired this showed the PIN card, which needed nothing fetched. Now it says what
 * happened in one line and offers a reload — `Try again` — which fetches the form afresh (a failed
 * dynamic import can stay failed for the life of the page, so retrying the import in place may not).
 * A card in the same family and slot as the others, so it replaces whatever is up and never stacks.
 */
export function showSignInUnavailable() {
    document.body.classList.add('calendar-locked');
    _deps.setWorkspaceHidden(true);
    const panel = mountLockCard({ id: 'calendarSignInUnavailable', labelledBy: 'calLockUnavailableTitle', html: `
        <div class="cal-lock-card">
            <img src="./icon-192.png" alt="" loading="eager">
            <div class="login-app-name">Marylebone Roster</div>
            <div class="login-subtitle" id="calLockUnavailableTitle">Calendar · Sign in</div>
            <p class="login-hint" id="calLockUnavailableWhy" role="status"></p>
            <button id="calLockSubmit" type="button">Try again</button>
        </div>` });
    if (!panel) return;
    const why = /** @type {HTMLElement|null} */ (panel.querySelector('#calLockUnavailableWhy'));
    // A live region mounted in this task: its words wait for it to be drawn, or nobody hears them.
    speakAfterMount(why, () => { if (why) why.textContent = SIGN_IN_UNAVAILABLE_LINE; });
    panel.querySelector('#calLockSubmit')?.addEventListener('click', () => { window.location.reload(); });
}

/**
 * The MEMBER's way back in — shown instead of the PIN card when a live local session has outlived
 * its Firebase identity.
 *
 * ── WHY THIS IS A SEPARATE SCREEN ───────────────────────────────────────────────────────────────
 *
 * `decideAccess` needs BOTH a local session and a restored Firebase user, and holding one without
 * the other is not a bug: a member with a 60-day local session can lose the identity behind it while
 * still being, as far as they and the app are concerned, signed in. (It is not Safari's seven-day
 * rule, as this said until 7 Nov 2026 — that deletes the local session WITH the identity;
 * KNOWN_LIMITATIONS → "One interaction to expect on iOS" has the likelier route.) Answering that
 * with the front door would ask a member the app already knows to start again from their grade.
 *
 * So the ONE thing this screen does is get their own identity back, through the app's real sign-in
 * overlay. The SILENT attempt no longer lives here (v21.62): the boot path runs `trySilentReauth`
 * behind the skeleton BEFORE this card exists, so by the time it is built, silence has already
 * failed (or is hanging past its defer bound) and the card renders immediately actionable — no
 * disabled "Signing you in…" limbo state. A shared PC where somebody left a session behind does not
 * strand the next person: the form's grade and name can be changed (the preset is a convenience, never
 * a gate), and the drawer's Sign out is there too. ("Sign out and use the staff PIN" went with the
 * PIN, 23 Nov 2026.)
 *
 * @param {string} name
 * @param {string} [why]  The explanation line. Defaults to the evicted-identity case; `handleAccessLost`
 *   passes the expired-session one.
 */
export function showMemberPanel(name, why = 'This device needs to sign you in again before it can show your roster. Enter your password to see it.') {
    // REPLACE, never early-return. The cards are alternatives for the same slot, and "a panel is
    // already up" is not a reason to leave the WRONG one there — the sign-in → member direction is
    // exactly what a re-lock followed by a fresh decision produces.
    hideLockPanel();
    document.body.classList.add('calendar-locked');
    _deps.setWorkspaceHidden(true);
    _deps.onAwaitingInput?.();   // the page now waits for the member to sign in again (perf-reporter.js)

    // The login family's card (`.cal-lock-card`, shared.css), and its primary button's id.
    const panel = mountLockCard({ labelledBy: 'calLockWho', html: `
        <div class="cal-lock-card">
            <img src="./icon-192.png" alt="" loading="eager">
            <div class="login-app-name">Marylebone Roster</div>
            <div class="login-subtitle" id="calLockWho">Calendar</div>
            <p class="login-hint" id="calLockWhy" role="status" aria-live="polite"></p>
            <button id="calLockSubmit" type="button">Sign in →</button>
        </div>` });
    if (!panel) return;

    // NOTE: the explanation keeps its `role="status"` live region even though the card now renders
    // in its final state (v21.62 — the waiting the two-state version represented happens behind the
    // skeleton before this card exists). A .login-error box was tried here once and looked exactly
    // like a disabled text field sitting above the button — on a card whose whole job is "sign in",
    // a faux input is the one thing it must not appear to have.
    const who    = /** @type {HTMLElement} */ (panel.querySelector('#calLockWho'));
    const submit = /** @type {HTMLButtonElement} */ (panel.querySelector('#calLockSubmit'));

    // textContent, not interpolation. The name comes from this device's own storage rather than any
    // remote source, so this is not a live injection route — but a panel built by string
    // concatenation on the app's front door is not the place to rely on where a value came from.
    who.textContent = `Calendar · ${name}`;
    const whyEl = /** @type {HTMLElement|null} */ (panel.querySelector('#calLockWhy'));
    // The reason is a live region mounted in this task, so it is written once the card has been drawn
    // (`speakAfterMount`): written here and now, it was never spoken.
    speakAfterMount(whyEl, () => { if (whyEl) whyEl.textContent = why; });

    // ── THE FORM IS FETCHED NOW, SO THE TAP CAN OPEN IT AT ONCE (iPhone audit, 7 Nov 2026) ─────────
    //
    // The form lands focus on the password box, and iOS raises its keyboard only for a focus made
    // synchronously inside the tap. Behind an `await` of the module it was outside it: the member
    // tapped "Sign in →", got a focused box, and had to tap the box again for a keyboard. So the
    // module is fetched while they read this card, and a tap that finds it here opens the form inside
    // the tap. A plain `import()` for the warm-up, not `lazyImport`: a failure here is nobody's tap,
    // so it must not reload the page — the tap's own load below still does, exactly as before.
    if (!_signInForm) import('./login-overlay.js').then(m => { _signInForm = m; },
        (e) => console.warn('[calendar-lock-cards] The sign-in form did not prefetch; the tap loads it:', e));

    submit.addEventListener('click', async () => {
        // The card's heading already names them; the form should not ask again (v23.58). The
        // overlay pre-selects grade and name and lands on the password field. `presetName` is a
        // convenience the overlay is free to ignore — it never widens who may sign in.
        //
        // ── ITS WAY BACK IS THIS CARD, IN PLACE (Nov 2026) ──────────────────────────────────────
        // The modal form's way back is "← Back to roster", a link to `./`, and its Escape follows the
        // link — on the Calendar, the page it is already on: both reloaded into this same card. So the
        // form is given an `alternative` (login-overlay.js replaces the link with a button that runs
        // it, and refuses it mid-sign-in), and Escape is caught on the way DOWN to the form's own
        // handler and sent to the same place — never while the form's own sign-in is out, as the
        // form refuses its own Escape then. The form goes; this card, which never left, takes focus.
        const back = (/** @type {typeof import('./login-overlay.js')} */ m) => {
            m.dismissLoginOverlay();
            if (submit.isConnected) { try { submit.focus(); } catch { /* noop */ } }
        };
        const open = (/** @type {typeof import('./login-overlay.js')} */ m) => {
            if (document.getElementById('loginOverlay')) return;   // already up — the form never mounts twice
            m.initLoginOverlay({ pageLabel: 'Calendar', onSuccess: () => { _deps.finishSignIn(); }, presetName: name,
                alternative: { label: '← Back', onSelect: () => back(m) } });
            // Capture, on the form itself: it runs before the form's own Escape (a bubbling listener on
            // the same element), and `stopImmediatePropagation` keeps that one from following its link.
            document.getElementById('loginOverlay')?.addEventListener('keydown', (/** @type {KeyboardEvent} */ e) => {
                if (e.key !== 'Escape') return;
                e.stopImmediatePropagation();
                if (!signInInFlight()) back(m);
            }, true);
        };
        if (_signInForm) { open(_signInForm); return; }   // inside the tap — see the block above
        /** @type {typeof import('./login-overlay.js')} */ let mod;
        // A failed load must not leave a dead button: say so and keep the button live. After a
        // release has claimed the page, `lazyImport` reloads onto it instead.
        try { mod = await lazyImport(() => import('./login-overlay.js')); }
        catch {
            if (whyEl) whyEl.textContent = SIGN_IN_UNAVAILABLE_LINE;
            return;
        }
        _signInForm = mod;   // so a grant can take the form down (`dismissSignInForm`)
        open(mod);
    });
}
