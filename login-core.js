// @ts-check
/**
 * login-core.js — the sign-in card's DOM-FREE rules: one sign-in attempt (`runNamedSignIn`), which links
 * the card's explanation may carry (`isAboutLinkAllowed`), what a failed reset request says
 * (`resetRequestFailureLine`), the forced set-password step's marker held across a typed attempt
 * (`holdPasswordMarker` / `releasePasswordMarker`) and a page's own sign-in explanation (`signInAboutFor`).
 *
 * Moved out of login-overlay.js (Nov 2026), which stood three lines under the size at which a module
 * must be capped (coordinator-ratchet.test.mjs): the card's markup and wiring stayed, and the three
 * things a Node test can hold without a DOM came here. Nothing about them changed in the move.
 * login-overlay.js imports them and re-exports them, so every caller and login-overlay.test.mjs still
 * reach them there. Imports no session state: `runNamedSignIn` is handed everything it touches. The forced
 * set-password step's marker, which the card holds for each typed attempt, is kept here too (Nov 2026):
 * localStorage only, through ls.js.
 */

import { isCredentialRejection } from './auth-identity.js';
// The one deadline helper (sessions-6 — the card kept a copy that differed only in the error's code).
// Every page that loads the card statically already loads password-force.js statically, and the
// Calendar loads the card on demand, so the import adds nothing to any page's start-up.
import { withTimeout } from './password-force.js';
import { lsGet, lsSet, lsDel } from './ls.js';
import { PW_FORCE_PENDING_PREFIX } from './storage-keys.js';

/**
 * How long one sign-in may take before the APP ends it (external review, 23 Nov 2026). It was 8 seconds —
 * `AUTH_RESTORE_TIMEOUT_MS`, the bound on finding a SAVED identity — and on patchy station Wi-Fi the card
 * said "Couldn’t complete sign-in" while Firebase went on to sign the colleague in a moment later. So 8
 * seconds is now only when the card says the attempt is taking longer than usual (login-overlay.js), and
 * the attempt runs to an answer, or to this. Past it the card says so, and an answer that still arrives —
 * the saved session it kept, now confirmed — opens the page (`late`, below; `awaitLateSignIn`).
 */
export const SIGN_IN_GIVE_UP_MS = 30_000;

/**
 * The DOM-free core of a sign-in attempt (exported for tests). Establishes the member's named
 * Firebase session, time-boxed, and commits the LOCAL session ONLY if auth genuinely resolves — so
 * a slow/hung auth can never leave a "half signed-in" state (the v14.72–75 login-freeze class; see
 * AUTH_AND_SESSIONS.md → "The login freeze"). Pure of DOM: the caller passes the already-name-bound session helpers, and
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
 * @param {number} [deps.timeoutMs]  when the app ends the attempt (`SIGN_IN_GIVE_UP_MS`)
 * @returns {Promise<{ ok: boolean, error?: string, kind?: 'timeout'|'ratelimit'|'transient'|'credential'|'other'|'storage', late?: Promise<boolean> }>}
 *   ok=true ⇒ local session saved; caller runs onSuccess. On failure, `kind` names the cause
 *   ('credential' = wrong password → the caller's lockout counts it; others must not). A 'timeout' carries
 *   `late`: the attempt itself, which may still answer — true only for a named session that answer made.
 */
export async function runNamedSignIn({ ensureNamedSession, saveSession, clearSession, getAuthError, isTransient, isCredential = isCredentialRejection, keepsLocalSession = () => false, releaseEndedHold = () => {}, timeoutMs = SIGN_IN_GIVE_UP_MS }) {
    let named = false, authResolved = true, threw = false;
    const attempt = Promise.resolve().then(ensureNamedSession).catch(() => { threw = true; return false; });
    try {
        named = await withTimeout(attempt, timeoutMs);
    } catch {
        authResolved = false;   // the app ended it: past `timeoutMs` with no answer
    }
    // A sign-in that THREW is a failure that has happened, not one still pending: said as the timeout
    // always said it (no answer was read), but with no `late` — nothing is left to arrive.
    if (threw) authResolved = false;
    if (!authResolved || !named) {
        // Never leave a stale/legacy session behind a failed sign-in — UNLESS it is this member's
        // own (v24.56, auth review). A returning member on the Calendar's come-back card holds a
        // live 60-day session whose Firebase identity has gone; one mistyped password or a
        // timeout on weak signal wiped it, and with it the silent re-sign-in that would have
        // worked once back online. A failure tells us nothing about whether THEIR session is
        // still theirs. Somebody else's session on this device still goes — with their push record.
        if (!keepsLocalSession()) { releaseEndedHold(); clearSession(); }
        // `kind` lets the caller act on the CAUSE (only a genuine wrong-password drives the client
        // lockout; a network/rate-limit failure must not). Messages follow AUTH_AND_SESSIONS.md → "Sign-in error copy" +
        // the house wording rule (an account matter → "the admin").
        if (!authResolved) return { ok: false, kind: 'timeout', error: 'Couldn’t complete sign-in — check your connection and try again.', ...(threw ? {} : { late: attempt.then(Boolean) }) };
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

// ── THE SET-PASSWORD STEP'S MARKER IS WRITTEN WHEN A TYPED ATTEMPT STARTS (review, 24 Nov 2026) ──────
//
// The forced set-password step (password-force.js) runs only where a one-shot marker says a real sign-in
// has just happened. It was written in the card's `opened` (login-overlay.js), once the attempt had answered — and an attempt's answer
// is not the first thing on the page to hear it. Firebase announces the new user to every
// `onAuthStateChanged` listener BEFORE the sign-in call returns to its caller, and two of those listeners
// act at once: the Calendar's late-identity watcher grants the moment nothing is in flight (after the
// app has ended the attempt at `SIGN_IN_GIVE_UP_MS`, nothing is), and page-session's late-identity hold
// reloads the page even mid-attempt. Either way the page opened before `opened` ran, found no marker, and
// a member who had typed their surname default was never asked to choose their own password.
//
// So the marker is written as the attempt STARTS, and held while any typed attempt for that member could
// still sign them in — the attempt in flight, and one the app ended whose answer may yet arrive (`late`).
// It is taken away again only when every one of them has answered NO, so a failed sign-in still leaves
// nothing to ambush a later ordinary load with (password-force.js → "WHY IT IS LOGIN-GATED"). Counted,
// not flagged: an ended attempt can still answer while a second is in flight, and the first NO must not
// take the second's marker. A marker that was already there when the first attempt began is somebody
// else's (a sign-in another page has not consumed yet) and is left alone.
//
// A LATE ANSWER AFTER A NEWER ATTEMPT THAT FAILED still signs them in, and keeps the marker. The same
// colleague tries again once the app has ended the first attempt, mistypes, and the first then lands.
// The card opens the page on it (`awaitLateSignIn`): it was their own correct password, Firebase holds
// that account whatever the card does (session.js leaves a same-member landing alone unless the session
// was cleared), and the Calendar's watcher and page-session's hold would open the page on it anyway —
// standing down would leave "Password not recognised" over a member who is signed in. One that lands
// while the retry is STILL IN FLIGHT is held for it and opens the page if the retry fails (external review
// of v26.67 — `_heldLateSignIn`), so long as the card still shows them and Firebase still holds their
// account — and when the app ends the retry too, the retry's own answer is still waited for, since it holds the
// marker until it comes (external review of v26.69). What does supersede it is checked there: a card moved to somebody else or taken down, a sign-out
// since, and a newer attempt for ANOTHER member, which clears the session, so session.js signs the late
// landing back out and it answers false.
//
// What it costs: a page closed mid-attempt leaves the marker behind, and that member's next grant asks
// `passwordStatus` once — which shows the step only to a member still on the surname default, the one
// person it is for. The alternative of making each listener wait for the card was the smaller change on
// the Calendar but not on page-session, and a listener added later would have to remember to wait too.

/** Typed attempts, per member, that could still sign that member in. Module-level, so a card rebuilt on
 *  the same page (page-session's "signed in again" card) shares the count. @type {Map<string, number>} */
const _markerHolds = new Map();
/** Members whose marker stays when their last hold is released: one of the attempts signed them in, or
 *  the marker was there before the first one began. Lives only while holds are outstanding. @type {Set<string>} */
const _markerKept = new Set();

/** A typed attempt for `name` is starting: the marker is in place before Firebase can announce anybody.
 *  @param {string} name */
export function holdPasswordMarker(name) {
    const key = PW_FORCE_PENDING_PREFIX + name;
    if (!_markerHolds.has(name) && lsGet(key)) _markerKept.add(name);
    _markerHolds.set(name, (_markerHolds.get(name) ?? 0) + 1);
    lsSet(key, '1');
}

/** A typed attempt for `name` has answered: `signedIn` when that answer signed them in. The marker goes
 *  only when this was the last attempt outstanding and none of them did. @param {string} name @param {boolean} signedIn */
export function releasePasswordMarker(name, signedIn) {
    if (signedIn) _markerKept.add(name);
    const left = (_markerHolds.get(name) ?? 1) - 1;
    if (left > 0) { _markerHolds.set(name, left); return; }
    _markerHolds.delete(name);
    if (!_markerKept.delete(name)) lsDel(PW_FORCE_PENDING_PREFIX + name);
}

// ── WHAT A PAGE IS, ON ITS SIGN-IN CARD (owner, 21 Nov 2026) ─────────────────────────────────────────
// Admin, Pay, New link and Trains pass their own explanation (`about`) to initLoginOverlay; the pages
// below did not, so the same card read differently from page to page. Theirs live here, read by page
// label, so the card says the same thing at load AND when a session is lost mid-visit (page-session.js
// passes no `about` of its own for these pages) without each coordinator carrying another copy. Each
// says what the page holds, that you sign in as yourself to use it, and has the
// shared-screen footnote Admin's and Pay's carry. `e2e/auth.spec.js` holds every page's card to it.
export const SHARED_SCREEN = 'On a shared screen, sign out from the menu when you finish.';
const SIGN_IN_ABOUT_BY_PAGE = Object.freeze({
    Settings: Object.freeze({
        lines: Object.freeze([
            'Your password, your work email for account recovery, and notifications on this device.',
            'They’re yours, so you sign in as yourself.',
        ]),
        footnote: SHARED_SCREEN,
    }),
    Operations: Object.freeze({
        lines: Object.freeze([
            'The admin’s tools: the Daily Huddle and circulars, the weekly roster upload, and staff sign-in accounts.',
            'Only the admin can use it, so you sign in as yourself.',
        ]),
        footnote: SHARED_SCREEN,
    }),
    'Link Designer': Object.freeze({
        lines: Object.freeze([
            'The design tool where new roster links are drawn up and checked.',
            'Only the colleagues designing them can use it, so you sign in as yourself.',
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
