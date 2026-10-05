// @ts-check
/**
 * error-reporter.js — Lightweight uncaught-error reporter (v13.31)
 *
 * Registers window.onerror and window.onunhandledrejection handlers.
 * Filters noise (cross-origin errors, known browser quirks, session-level duplicates).
 * Writes surviving errors to the Firestore `clientErrors` collection so they are
 * visible in the Operations page Error Log card without needing DevTools access.
 *
 * Call initErrorReporter() once per page after the Firebase Auth session is
 * established — the Firestore write requires a member, the admin or the PIN viewer (v24.56).
 *
 * ── THE THREE CANONICAL CALL SITES (v13.78) ─────────────────────────────────────────────────
 *
 * NEVER call this bare. Without an auth context every write is silently rejected by the rules, so
 * the error log looks HEALTHY because it is broken — which is the one failure mode a reporter must
 * not have. There are three shapes, and they differ because the pages establish identity
 * differently:
 *
 *   1. `calendar-app.js` — the page that may have no named user at all. It waits on
 *      `calendarAuthReady` (calendar-access.js), which resolves only once access is GRANTED to a
 *      named member or the PIN's viewer, both of which already hold a real Firebase identity:
 *
 *          calendarAuthReady.finally(() => { initErrorReporter(); … })
 *
 *      A locked Calendar therefore never starts the reporter, and nothing signs in anonymously to
 *      make it: the rules accept no anonymous session (v20.12), and the switch that last restored
 *      one on this page (`CALENDAR_PIN_ACCESS`, its `open` mode) was retired v24.34. The access
 *      decision runs `reconcileExpiredIdentity()` first, so a valid named identity is PRESERVED
 *      rather than raced or replaced.
 *   2. **Authenticated pages that expose `sessionReady`** — `admin-app.js`, `settings-app.js`,
 *      `operations-app.js`, `links-app.js`: `sessionReady.then(() => initErrorReporter())`.
 *   3. `paycalc-app.js`, which has no `sessionReady`:
 *      `ensureNamedSession(name).catch(() => {}).finally(afterAuth)`, where `afterAuth` runs this
 *      alongside `recordUsage`/`recordPageLatency`. The no-member `else` branch calls `afterAuth()`
 *      directly.
 *
 * `AUTH_AND_SESSIONS.md` invariant 13 states the rule; this is where the shapes live.
 */

import { APP_VERSION } from './roster-data.js';
import { logClientError, auth } from './firebase-client.js';
import { lsGet } from './ls.js';
import { AUTH_KEY } from './session.js';
import { shouldReport, APP_SCRIPT_ORIGINS, DIAGNOSTIC_PREFIX } from './client-errors.js';
import { SLOW_SAVE_EVENT } from './slow-save.js';

// Deduplicate within the current page session — one Firestore write per distinct message.
const _seen = new Set();



/**
 * Apply noise filters then write to Firestore.
 * Never throws — a throwing reporter would cause an infinite re-entry loop.
 * @param {unknown} err      - Error object, rejection reason, or message string
 * @param {string}  [src=''] - Source URL (from window.onerror) or current pathname
 */
function _report(err, src = '') {
    try {
        // Plain-object rejections (reject({code:…})) stringify to "[object Object]" — one useless
        // record whose dedup key then suppressed every OTHER distinct object rejection for the
        // session. Serialise them (bounded) so the Error Log shows the actual payload (v16.23).
        const message = (err instanceof Error ? err.message
            : (err !== null && typeof err === 'object')
                ? (() => { try { return JSON.stringify(err).slice(0, 300); } catch { return String(err); } })()
                : String(err ?? '')).trim();

        // An unhandledrejection carries no filename, so `src` is the pathname — which would hide
        // the SDK origin the IndexedDB filter keys off. Recover it from the stack, which for an
        // SDK-internal throw names the gstatic file on every frame.
        const stackText = err instanceof Error ? (err.stack ?? '') : '';
        const origin = APP_SCRIPT_ORIGINS.find(o => src.includes(o) || stackText.includes(o));
        if (!shouldReport(message, origin || src, location.hostname)) return;

        // One report per distinct message per page session — don't flood Firestore if
        // the same bug fires on every keypress or scroll event.
        const dedupKey = message.slice(0, 120);
        if (_seen.has(dedupKey)) return;
        _seen.add(dedupKey);

        const stack      = (err instanceof Error ? (err.stack ?? '') : '').slice(0, 800);
        // Guard the parse: a corrupted AUTH_KEY blob would throw here, and the reporter's
        // outer catch would then swallow EVERY error for the session — the broken-session
        // case (most likely to be generating errors) is exactly when this must still write.
        let memberName = 'unknown';
        try { memberName = JSON.parse(lsGet(AUTH_KEY) ?? 'null')?.name ?? 'unknown'; } catch { /* corrupt blob → 'unknown', still report */ }
        const page       = location.pathname.replace(/^.*\//, '') || 'index.html';

        // Fire-and-forget — no await; logClientError swallows its own write errors.
        logClientError({ memberName, page, message: message.slice(0, 300), stack, appVersion: APP_VERSION, userAgent: navigator.userAgent.slice(0, 150) });
    } catch {
        // Never surface a secondary error from the reporter itself.
    }
}

/**
 * Register global uncaught-error handlers for the current page.
 * Call once per page after the Firebase Auth session is established.
 */
export function initErrorReporter() {
    window.addEventListener('error', e => _report(e.error ?? e.message, e.filename ?? ''));
    window.addEventListener('unhandledrejection', e => _report(e.reason, location.pathname));
    window.addEventListener(SLOW_SAVE_EVENT, e => {
        const d = /** @type {CustomEvent} */ (e).detail;
        if (d?.phase === 'slow') _timeToken(d.id); else _reportSlowSave(d);
    });
}

/** Slow saves recorded this page session — a ceiling, so a genuinely bad signal cannot flood the log. */
let _slowSavesLogged = 0;

/**
 * How long a sign-in TOKEN took to arrive, measured from the moment the save became slow (v24.55).
 * Firestore cannot send a request without one, so a slow save has two broad causes and this is what
 * tells them apart: a token that took seconds means AUTH is the bottleneck; a token in milliseconds
 * with the save still waiting means the CONNECTION to the server is — with one caveat (v24.57,
 * review): timing starts at the slow moment, so a token refresh that stalled the save and then
 * FINISHED inside those first seconds reads as milliseconds here. "Milliseconds" means auth is not
 * what is still holding the save; it cannot rule out auth having held it earlier.
 * Kept PER SAVE (by the event's `id`), so two slow saves at once cannot borrow each other's timing.
 * @type {Map<number, { ms: number|null, state: string }>}
 */
const _tokens = new Map();

/** Start timing a token for the save that has just become slow. @param {number} id */
function _timeToken(id) {
    const user = auth?.currentUser;
    if (!user) { _tokens.set(id, { ms: null, state: 'no signed-in user' }); return; }
    const t0 = Date.now();
    _tokens.set(id, { ms: null, state: 'still waiting' });
    user.getIdToken().then(
        () => { if (_tokens.has(id)) _tokens.set(id, { ms: Date.now() - t0, state: 'ok' }); },
        () => { if (_tokens.has(id)) _tokens.set(id, { ms: Date.now() - t0, state: 'failed' }); });
}

/** The token half of the diagnostic line, for one save. @param {number|undefined} id */
function _tokenText(id) {
    const t = (id !== undefined && _tokens.get(id)) || { ms: null, state: 'not measured' };
    return t.state === 'ok' ? `sign-in token ${(/** @type {number} */ (t.ms) / 1000).toFixed(1)}s`
         : t.state === 'failed' ? `sign-in token FAILED after ${(/** @type {number} */ (t.ms) / 1000).toFixed(1)}s`
         : `sign-in token ${t.state}`;
}

/**
 * Record a save the SERVER took longer than SLOW_SAVE_MS to confirm while the browser said it was
 * ONLINE (v24.54). Not an error: a DIAGNOSTIC, written to the one log the admin can already read.
 * It exists because an installed iPhone app took longer than that on every week-grid save with full
 * signal, and nothing recorded which part was slow or on what. An offline-when-slow save is the
 * expected case and is not recorded. Same fields as any error, so the rules need nothing new.
 * @param {{ id?: number, ms?: number, onlineWhenSlow?: boolean, batched?: boolean, ok?: boolean }} d
 */
function _reportSlowSave(d) {
    try {
        const token = _tokenText(d?.id);
        if (d?.id !== undefined) _tokens.delete(d.id);
        if (!d || !d.onlineWhenSlow || _slowSavesLogged >= 3) return;
        _slowSavesLogged++;
        const installed = !!(window.matchMedia?.('(display-mode: standalone)')?.matches || /** @type {any} */ (navigator).standalone);
        // "fail", not "refuse" (v24.57): a save can also end on the device — abandoned by a sign-out.
        _report(`${DIAGNOSTIC_PREFIX}: the save took ${((d.ms ?? 0) / 1000).toFixed(1)}s to ${d.ok === false ? 'fail' : 'be confirmed'} — a ${d.batched ? 'batched ' : ''}save while the phone said it was online · ${token} · installed app: ${installed ? 'yes' : 'no'}`, location.pathname);
    } catch { /* never surface a secondary error from the reporter */ }
}
