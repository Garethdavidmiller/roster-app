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
 */

import { APP_VERSION } from './roster-data.js';
import { logClientError } from './firebase-client.js';
import { lsGet } from './ls.js';
import { AUTH_KEY } from './session.js';
import { shouldReport, APP_SCRIPT_ORIGINS } from './client-errors.js';

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
}
