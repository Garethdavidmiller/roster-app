// @ts-check
/**
 * login-core.js — the sign-in card's DOM-FREE rules: one sign-in attempt (`runNamedSignIn`), which links
 * the card's explanation may carry (`isAboutLinkAllowed`) and what a failed reset request says
 * (`resetRequestFailureLine`).
 *
 * Moved out of login-overlay.js (Nov 2026), which stood three lines under the size at which a module
 * must be capped (coordinator-ratchet.test.mjs): the card's markup and wiring stayed, and the three
 * things a Node test can hold without a DOM came here. Nothing about them changed in the move.
 * login-overlay.js imports them and re-exports them, so every caller and login-overlay.test.mjs still
 * reach them there. Imports no session state: `runNamedSignIn` is handed everything it touches.
 */

import { isCredentialRejection } from './auth-identity.js';
// The one deadline helper (sessions-6 — the card kept a copy that differed only in the error's code).
// Every page that loads the card statically already loads password-force.js statically, and the
// Calendar loads the card on demand, so the import adds nothing to any page's start-up.
import { withTimeout } from './password-force.js';
// The one "how long may Firebase take" bound (8s, the login freeze's budget) — pure, so no SDK import here.
import { AUTH_RESTORE_TIMEOUT_MS } from './silent-sign-in.js';

/**
 * The DOM-free core of a sign-in attempt (exported for tests). Establishes the member's named
 * Firebase session, time-boxed, and commits the LOCAL session ONLY if auth genuinely resolves — so
 * a slow/hung auth can never leave a "half signed-in" state (the v14.72–75 login-freeze class; see
 * ROADMAP_HISTORY.md → "The login freeze"). Pure of DOM: the caller passes the already-name-bound session helpers, and
 * applies the button/error effects from the result. A resolved-but-NOT-named result is a failure:
 * there is no anonymous session to accept (the `enforce` dep, fed by the `ENFORCE_NAMED_SESSION`
 * switch, was retired v24.34).
 *
 * @param {object} deps
 * @param {() => Promise<boolean>} deps.ensureNamedSession  pre-bound to the member name
 * @param {() => boolean} deps.saveSession                  pre-bound to the member name; returns false if storage is blocked
 * @param {() => void} deps.clearSession
 * @param {() => (string|null|undefined)} deps.getAuthError
 * @param {(code: any) => boolean} deps.isTransient
 * @param {(code: any) => boolean} [deps.isCredential]  a DEFINITIVE credential rejection — by default
 *   the shared `isCredentialRejection` (auth-identity.js) the sign-in ladder itself stops on
 * @param {() => boolean} [deps.keepsLocalSession]  true when this device already holds a session for
 *   the SAME member — a failed attempt then leaves it alone (v24.56; see the failure branch)
 * @param {() => void} [deps.releaseEndedHold]  runs just before a failure clears the session, and
 *   releases this device's push record when the session is ANOTHER member's (audit A1) — not awaited
 * @param {() => void} [deps.forgetStaffPinEnded]  on success: the PIN's end is no longer this page's news
 * @param {number} [deps.timeoutMs]
 * @returns {Promise<{ ok: boolean, error?: string, kind?: 'timeout'|'ratelimit'|'transient'|'credential'|'other'|'storage' }>}
 *   ok=true ⇒ local session saved; caller runs onSuccess. On failure, `kind` names the cause
 *   ('credential' = wrong password → the caller's lockout counts it; others must not).
 */
export async function runNamedSignIn({ ensureNamedSession, saveSession, clearSession, getAuthError, isTransient, isCredential = isCredentialRejection, keepsLocalSession = () => false, releaseEndedHold = () => {}, forgetStaffPinEnded = () => {}, timeoutMs = AUTH_RESTORE_TIMEOUT_MS }) {
    let named = false, authResolved = true;
    try {
        named = await withTimeout(ensureNamedSession(), timeoutMs);
    } catch {
        authResolved = false;   // timed out (or threw) → treat as not signed in
    }
    if (!authResolved || !named) {
        // Never leave a stale/legacy session behind a failed sign-in — UNLESS it is this member's
        // own (v24.56, auth review). A returning member on the Calendar's come-back card holds a
        // live 60-day session whose Firebase identity has gone; one mistyped password or a
        // timeout on weak signal wiped it, and with it the silent re-sign-in that would have
        // worked once back online. A failure tells us nothing about whether THEIR session is
        // still theirs. Somebody else's session on this device still goes — with their push record.
        if (!keepsLocalSession()) { releaseEndedHold(); clearSession(); }
        // `kind` lets the caller act on the CAUSE (only a genuine wrong-password drives the client
        // lockout; a network/rate-limit failure must not). Messages follow PASSWORD_DESIGN.md §3.5 +
        // the house wording rule (an account matter → "the admin").
        if (!authResolved) return { ok: false, kind: 'timeout', error: 'Couldn’t complete sign-in — check your connection and try again.' };
        const code = getAuthError();
        if (code === 'auth/too-many-requests') return { ok: false, kind: 'ratelimit', error: 'Too many attempts — wait a few minutes and try again.' };
        // A browser that could not sign an account OUT is transient to the session (it keeps the 60-day
        // session — session.js) but it is no network fault: the card says what the 'other' line says.
        if (isTransient(code) && !/-shed-failed$/.test(String(code))) return { ok: false, kind: 'transient', error: 'Couldn’t reach sign-in — check your connection and try again.' };
        // Definitive credential rejection — covers BOTH a wrong/forgotten password AND an account that
        // was never provisioned (auth/user-not-found). The remedy for the latter is set-up, not a
        // reset, so the wording names "the admin" generically (an account matter — house rule) and
        // doesn't wrongly promise a reset that can't fix an unset-up account. ONE sentence for both,
        // so the card never tells a stranger which of the two it was.
        if (isCredential(code)) return { ok: false, kind: 'credential', error: 'Password not recognised — if you’ve forgotten it, or your account isn’t set up yet, ask the admin.' };
        // EVERYTHING ELSE IS NOT A PASSWORD PROBLEM (sessions-2, Nov 2026). Until then this fell through
        // to the line above: a site missing from the API key's allowed referrers, a disabled account,
        // sign-in switched off, or the Calendar viewer that could not be signed out — each told the
        // member their password was wrong, counted towards the lockout and, from the second, pushed
        // the reset link, filing requests a reset cannot answer. So: not counted, no reset prompt, the
        // typed password kept for the retry. The sentence names no cause and no account state, so it
        // reads the same for every name (Firebase's own response is in the browser anyway); "the
        // admin" because each cause is an app or account matter.
        return { ok: false, kind: 'other', error: 'Couldn’t sign you in. Try again — if it keeps happening, ask the admin.' };
    }
    // Commit ONLY now that auth has genuinely resolved. If the write is swallowed (storage blocked —
    // on an iPhone, Safari's Block All Cookies; Private Browsing has not refused storage since iOS 11,
    // so the old advice to turn it off sent members after the wrong setting), fail cleanly: without
    // the local session every page re-check returns null,
    // so an in-place re-init or reload would just loop back to this overlay. Sign back out (clearSession)
    // so we don't strand a signed-in Firebase identity with no app session, and tell the user why.
    if (!saveSession()) {
        clearSession();
        return { ok: false, kind: 'storage', error: 'This browser is blocking storage, which the app needs to keep you signed in. Allow cookies and website data for this site — on an iPhone, turn off Block All Cookies in Safari’s settings — then sign in again.' };
    }
    // A member is signed in here now: a later card on this page must not say the PIN ended (audit B2/C2).
    forgetStaffPinEnded();
    return { ok: true };
}

/**
 * Whether a link may go on the sign-in card's explanation: a same-origin RELATIVE path ("./…") and
 * nothing else. This card is every page's way in, so it never carries a link elsewhere — not an
 * absolute URL, not a protocol-relative "//host", not a `javascript:` one. Pure, so the rule is
 * unit-tested (login-overlay.test.mjs) rather than read; `fillAbout` drops a refused link silently.
 * @param {unknown} href
 * @returns {boolean}
 */
export function isAboutLinkAllowed(href) {
    return typeof href === 'string' && /^\.\/[\w.\-/#?=&]*$/.test(href);
}

/** What the card says when a reset request fails — PURE. A TIMEOUT may have arrived (the server records
 *  before it answers, so "couldn't send" would have them ask again, for the throttle to drop it); a 404
 *  (the server's staff list lacks the name) and a 503 (requests switched off) are ANSWERS that trying
 *  again will not change, so each sends them to the admin. @param {any} err  `requestPasswordReset`'s
 *  rejection ("Server responded <status>: …") @param {boolean} timedOut @returns {string} */
export function resetRequestFailureLine(err, timedOut) {
    if (timedOut) return 'Couldn’t confirm the request reached the admin — it may have gone through. If your password isn’t reset soon, contact the admin directly.';
    const status = /^Server responded (\d{3})\b/.exec(String(err?.message ?? ''))?.[1];
    if (status === '404') return 'Your name isn’t on the app’s list for reset requests yet — contact the admin directly.';
    if (status === '503') return 'Reset requests aren’t available at the moment — contact the admin directly.';
    return 'Couldn’t send the request — check your connection, or contact the admin directly.';
}

// ── WHAT A PAGE IS, ON ITS SIGN-IN CARD (owner, 21 Nov 2026) ─────────────────────────────────────────
// Admin, Pay, New link and Trains pass their own explanation (`about`) to initLoginOverlay; the pages
// below did not, so the same card read differently from page to page. Theirs live here, read by page
// label, so the card says the same thing at load AND when a session is lost mid-visit (page-session.js
// passes no `about` of its own for these pages) without each coordinator carrying another copy. Each
// says what the page holds, that the staff PIN does not open it (AUTH_AND_SESSIONS 18, 24), and has the
// shared-screen footnote Admin's and Pay's carry. `e2e/auth.spec.js` holds every page's card to it.
const SHARED_SCREEN = 'On a shared screen, sign out from the menu when you finish.';
const SIGN_IN_ABOUT_BY_PAGE = Object.freeze({
    Settings: Object.freeze({
        lines: Object.freeze([
            'Your password, your work email for account recovery, and notifications on this device.',
            'They belong to your own account, so you sign in as yourself — the staff PIN doesn’t open it.',
        ]),
        footnote: SHARED_SCREEN,
    }),
    Operations: Object.freeze({
        lines: Object.freeze([
            'The admin’s tools: the Daily Huddle and circulars, the weekly roster upload, and staff sign-in accounts.',
            'Only the admin can use it, so you sign in as yourself — the staff PIN doesn’t open it.',
        ]),
        footnote: SHARED_SCREEN,
    }),
    Links: Object.freeze({
        lines: Object.freeze([
            'The workspace where new roster links are designed and checked.',
            'Only the colleagues designing them can use it, so you sign in as yourself — the staff PIN doesn’t open it.',
        ]),
        footnote: SHARED_SCREEN,
    }),
});

/**
 * The sign-in card's explanation for a page that does not pass its own (the note above).
 * @param {string} pageLabel  initLoginOverlay's `pageLabel`
 * @returns {{ lines: readonly string[], footnote: string } | null}
 */
export function signInAboutFor(pageLabel) {
    return Object.hasOwn(SIGN_IN_ABOUT_BY_PAGE, pageLabel) ? SIGN_IN_ABOUT_BY_PAGE[/** @type {keyof typeof SIGN_IN_ABOUT_BY_PAGE} */ (pageLabel)] : null;
}
