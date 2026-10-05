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
 * established — the Firestore write requires request.auth != null.
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
import { logClientError } from './firebase-client.js';
import { lsGet } from './ls.js';
import { AUTH_KEY } from './session.js';
import { shouldReport, APP_SCRIPT_ORIGINS } from './client-errors.js';
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
    window.addEventListener(SLOW_SAVE_EVENT, e => _reportSlowSave(/** @type {CustomEvent} */ (e).detail));
}

/** Slow saves recorded this page session — a ceiling, so a genuinely bad signal cannot flood the log. */
let _slowSavesLogged = 0;

/**
 * Record a save the SERVER took longer than SLOW_SAVE_MS to confirm while the browser said it was
 * ONLINE (v24.54). Not an error: a DIAGNOSTIC, written to the one log the admin can already read.
 * It exists because an installed iPhone app took longer than that on every week-grid save with full
 * signal, and nothing recorded which part was slow or on what. An offline-when-slow save is the
 * expected case and is not recorded. Same fields as any error, so the rules need nothing new.
 * @param {{ ms?: number, onlineWhenSlow?: boolean, batched?: boolean, ok?: boolean }} d
 */
function _reportSlowSave(d) {
    try {
        if (!d || !d.onlineWhenSlow || _slowSavesLogged >= 3) return;
        _slowSavesLogged++;
        const installed = !!(window.matchMedia?.('(display-mode: standalone)')?.matches || /** @type {any} */ (navigator).standalone);
        _report(`Slow save (diagnostic): the server took ${((d.ms ?? 0) / 1000).toFixed(1)}s to ${d.ok === false ? 'refuse' : 'confirm'} a ${d.batched ? 'batched ' : ''}save while the phone said it was online · installed app: ${installed ? 'yes' : 'no'}`, location.pathname);
    } catch { /* never surface a secondary error from the reporter */ }
}
