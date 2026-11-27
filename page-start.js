// @ts-check
/**
 * page-start.js — ONE page start-up for every page that opens the shared sign-in card (the Template
 * Method pattern: this module owns the ORDER and the two decisions; each page supplies only its own
 * parts).
 *
 * WHY IT EXISTS (maintainability review, Nov 2026). Eight coordinators — Admin, Operations, Settings,
 * Links, the Pay Calculator, Trains, New link and Overtime — each wrote the same skeleton by hand:
 * install the Back guard, decide access, open the sign-in card on 'login' with an in-place
 * continuation, re-establish the member's Firebase session, start the error reporter and the usage
 * counts once the session is ready. A real defect came from one page writing it differently: Admin
 * decided "not for this login" only at load, so an Other Staff login made on Admin's OWN card got the
 * whole page (v26.85). And its refusal path had dropped the session step twice over — no `sessionReady`
 * until v26.72, and never the forced set-password step. A skeleton cannot forget a step on one path.
 *
 * ── THE ORDER (what `startPage` does, and nothing a page may reorder) ─────────────────────────────
 *
 *   1. THE BACK GUARD FIRST (`reloadIfRestoredForSomeoneElse`), so no decision below — a sign-in, a
 *      refusal — can return before it is installed.
 *   2. DECIDE, from the LOCAL session (`requirePage`, or the page's own `decide`): the auth store is
 *      often still initialising here, and a role-gated page must not read `pending` as `allow`.
 *   3. 'login' → `beforeCard` (what the page puts up first — Overtime's drawer; Trains waits, within a
 *      budget, for a leftover session's teardown), then the shared card, whose `onSuccess` is the
 *      continuation below.
 *   4. THE CONTINUATION, after an in-place sign-in: no named session by now → RELOAD into a fresh
 *      sign-in, never run the page for nobody (re-entering 'login' would find the card still mounted
 *      and soft-lock on "Signed in…"); the page is now theirs (`rebaseRestoreGuard`, or a Back to it
 *      reloads for nothing); then DECIDE AGAIN for whoever actually signed in — the card was opened
 *      for nobody, and a login the page is not for gets the refusal, never the page. A throw anywhere
 *      in it reloads, so the in-place path is never less robust than the reload one. Nothing in it is
 *      awaited (the login freeze, AUTH_AND_SESSIONS.md → "The login freeze").
 *   5. 'forbidden' → the card dismissed, the session step (only where the refusal is a page of its own
 *      for a signed-in member, `refusalKeepsSession`; otherwise `sessionReady` is settled `false`, a
 *      one-shot promise other modules may await), then the page's `refuse`.
 *   6. 'allow' → the card dismissed, the session step, then the page's `run` (or, for a page written
 *      as one long `init`, `true` so it carries on inline — `again`, below).
 *
 * THE SESSION STEP (`establish`, on by default) is what every named page did first: the member's own
 * Firebase session re-established (`ensureNamedSession` — without it a returning member's every write
 * fails), `sessionReady` fulfilled (`resolveSession`), `guardNamedSession` (sign in again now if it
 * cannot be confirmed, and later if it goes), the forced set-password step NOW with the session as its
 * barrier (its one-shot marker is spent as the page opens — password-force.js), and the error reporter
 * and the usage count behind `sessionReady` (never bare: AUTH_AND_SESSIONS 13), with the page-latency
 * sample on an allowed page unless the page times it itself (`recordLatency: false` — Overtime, whose
 * content needs two round trips first). They are registered BEFORE `run`, so the reporter is listening
 * before the page's own `sessionReady` work starts.
 *
 * ── TWO WAYS A PAGE HANDS OVER ITS START ──────────────────────────────────────────────────────────
 *
 * `run(member, { inPlace })` — the page's start as a function. The skeleton calls it after an 'allow',
 * at load and after an in-place sign-in alike. Admin, Settings, Trains, New link and Overtime.
 * `again` — the page's whole `init`, for a coordinator whose start is the rest of `init` itself
 * (Operations, Links, the Pay Calculator): `if (!startPage({ …, again: init })) return;`. After an
 * in-place sign-in the continuation runs `init` again, and its `startPage` decides afresh — so the
 * re-decision is still this module's, and the page's body is reached only when it says 'allow'.
 * Exactly one of the two; anything else throws, at the first load, where every test sees it.
 *
 * ── WHAT IT DELIBERATELY DOES NOT OWN ─────────────────────────────────────────────────────────────
 *
 * Steps whose position each page argues in its own comments stay in the page:
 *   - THE DRAWER. Settings wires it once, with the signed-in identity; Overtime wires it while signed
 *     out, on purpose, and rebuilds it after a sign-in; Admin hangs its Calendar pill's month on it.
 *   - THE SERVICE WORKER. Every page registers it BEFORE this call (a signed-out or refused view must
 *     still take an update), with a busy check that is the page's own and that
 *     page-contract-parity.test.mjs reads from the page.
 *   - THE EXPIRED-IDENTITY TEARDOWN (`reconcileExpiredIdentity`), also before this call — Trains races
 *     it against a budget before its card, which `beforeCard` is for.
 * The Calendar is not a card-opening page in this sense: its lock cards sign in through `finishSignIn`
 * (calendar-access.js), which rebuilds the month. And none of this decides ACCESS: `auth-policy.js`
 * does, and the Firestore rules are the boundary.
 *
 * `page:` is written FIRST in every call: page-contract-parity.test.mjs and firestore-contract-parity
 * read the page id from `startPage({ page: '…'`.
 */

import { getSession, ensureNamedSession, resolveSession, sessionReady } from './session.js';
import { reloadIfRestoredForSomeoneElse, rebaseRestoreGuard, guardNamedSession } from './page-session.js';
import { requirePage } from './auth-policy.js';
import { initLoginOverlay, dismissLoginOverlay } from './login-overlay.js';
import { initPasswordForce } from './password-force.js';
import { initErrorReporter } from './error-reporter.js';
import { recordUsage } from './usage-reporter.js';
import { recordPageLatency } from './perf-reporter.js';
import { showMirrorBanner } from './mirror-move.js';

/** @typedef {import('./auth-policy.js').AuthDecision} AuthDecision */
/** @typedef {{ inPlace: boolean }} StartContext */
/**
 * @typedef {object} PageStart
 * @property {string} page    the policy id (`PAGE_POLICIES`) — also the usage and latency id, and the page `guardNamedSession` asks about
 * @property {string} label   the card's and the lost-session card's `pageLabel`, e.g. 'Admin'
 * @property {import('./login-overlay.js').LoginAbout|null} [about]  what the page is, on both cards (absent: login-core.js's entry for `label`)
 * @property {(session: any, byPolicy: () => AuthDecision) => AuthDecision} [decide]  the page's own decision, given the policy's
 * @property {() => (void|Promise<unknown>)} [beforeCard]  runs before the load-time card; a promise it returns is waited for
 * @property {(member: string, ctx: StartContext) => void} [run]  the page's start, after an 'allow'
 * @property {() => void} [again]  the page's whole init, run again after an in-place sign-in (instead of `run`)
 * @property {(decision: AuthDecision, ctx: StartContext & { member: string|null }) => void} refuse  the page for a login it is not for
 * @property {boolean} [establish]  false: the page owns its auth chain (the Pay Calculator's SOFT policy) and the skeleton touches no session
 * @property {boolean} [refusalKeepsSession]  the refusal is a page of its own for a signed-in member, so it gets the session step too
 * @property {() => void} [beforeSignInAgain]  `guardNamedSession`'s `beforeSignIn`: what the page puts away before a later sign-in card
 * @property {boolean} [recordLatency]  false: the page records its own latency sample (default true)
 */

/** The decisions that run the page. 'soft-allow' is the Pay Calculator's member whose session is unconfirmed. */
const RUNS = new Set(['allow', 'soft-allow']);

/** True while the continuation re-enters an `again` page, so that pass knows it is in place. */
let _resuming = false;

/**
 * Start a page that opens the shared sign-in card: the Back guard, the decision at load, the card and its
 * continuation (which decides again for whoever signed in), the refusal or the page, and the session step.
 * @param {PageStart} spec
 * @returns {boolean} whether the CALLER carries on with its start now — only ever true for an `again` page
 *   that was allowed; a `run` page's start has been run by then, and a refused or signed-out one has nothing to do.
 */
export function startPage(spec) {
    if (!spec.run === !spec.again) throw new TypeError(`[page-start] ${spec.page}: pass exactly one of run and again`);
    reloadIfRestoredForSomeoneElse();                       // 1. before any branch below can return
    showMirrorBanner({ pay: spec.page === 'paycalc' });     // a desktop at the Pages mirror only (mirror-move.js)
    return decideAndRoute(spec, _resuming);
}

/**
 * Steps 2, 5 and 6 — at load, and (for a `run` page) again inside the continuation.
 * @param {PageStart} spec @param {boolean} inPlace @returns {boolean}
 */
function decideAndRoute(spec, inPlace) {
    const { page, establish = true, refusalKeepsSession = false, recordLatency = true } = spec;
    const session = getSession();
    const member = session?.name ?? null;
    const byPolicy = () => requirePage({ status: member ? 'named' : 'signedOut', member }, page);
    const answer = spec.decide ? spec.decide(session, byPolicy) : byPolicy();
    if (answer.decision !== 'forbidden' && !RUNS.has(answer.decision)) {
        // Still not a decision the page can act on. After a sign-in that would be the card re-opened over
        // itself, so a fresh load asks instead; at load it is the sign-in.
        if (inPlace) window.location.reload();
        else openCard(spec);
        return false;
    }
    dismissLoginOverlay();                                  // the card, if the continuation got here; a no-op at load
    if (answer.decision === 'forbidden') {
        if (establish) {
            if (refusalKeepsSession && member) startSession(spec, member, false);
            else resolveSession(false);                     // one-shot: never left pending for whatever is wired later
        }
        spec.refuse(answer, { member, inPlace });
        return false;
    }
    if (establish && member) startSession(spec, member, recordLatency);
    if (spec.run) { spec.run(/** @type {string} */ (member), { inPlace }); return false; }
    return true;
}

/** Step 3: the shared card, after whatever the page puts up first. @param {PageStart} spec */
function openCard(spec) {
    const open = () => initLoginOverlay({ pageLabel: spec.label, about: spec.about ?? null, onSuccess: continuation(spec) });
    const gate = spec.beforeCard?.();
    if (gate && typeof /** @type {any} */ (gate).then === 'function') /** @type {Promise<unknown>} */ (gate).then(open, open);
    else open();
}

/**
 * Step 4: the card's `onSuccess`.
 * @param {PageStart} spec @returns {() => void}
 */
function continuation(spec) {
    return () => {
        try {
            if (!getSession()?.name) { window.location.reload(); return; }
            rebaseRestoreGuard();
            if (spec.again) {
                _resuming = true;
                try { spec.again(); } finally { _resuming = false; }
                return;
            }
            decideAndRoute(spec, true);
        } catch { window.location.reload(); }
    };
}

/**
 * The session step, for a member the page is about to show something to.
 * @param {PageStart} spec @param {string} member @param {boolean} withLatency
 */
function startSession(spec, member, withLatency) {
    const established = ensureNamedSession(member);
    resolveSession(established);
    guardNamedSession({ page: spec.page, pageLabel: spec.label, member, established, about: spec.about ?? null,
        beforeSignIn: spec.beforeSignInAgain });
    // It fails open by itself; the `.catch` only keeps an unexpected rejection from going unhandled.
    initPasswordForce(member, { ready: sessionReady }).catch(() => {});
    sessionReady.then(() => {
        initErrorReporter();
        recordUsage(spec.page, member);
        if (withLatency) recordPageLatency(spec.page, member);
    });
}
