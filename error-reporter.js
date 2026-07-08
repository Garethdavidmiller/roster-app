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

        // Cross-origin script errors arrive as the literal string "Script error."
        // with no useful stack — useless and very frequent from browser extensions.
        if (!message || message === 'Script error.') return;

        // Chrome fires this for layout side-effects of third-party content; it is
        // cosmetic and cannot be acted on.
        if (message.includes('ResizeObserver loop')) return;

        // Chrome emits this as an unhandled rejection when its own background SW-update
        // check fails due to a network blip. Only suppress when accompanied by a recognised
        // network/fetch failure phrase — genuine SW installation failures (e.g. a bad script
        // that can't be parsed or executed) use different phrasing and should still be logged.
        if (message.includes('Failed to update a ServiceWorker') &&
            (message.includes('net::') || message.includes('NetworkError') ||
             message.includes('Failed to fetch') || message.includes('Load failed'))) return;

        // Errors whose source URL is a different origin usually belong to extensions or injected
        // scripts — out of scope. But the app's OWN dependencies load from CDNs (Firebase SDK on
        // www.gstatic.com, Mammoth on cdn.jsdelivr.net), and a crash inside those is a genuine
        // app-breaking failure that must reach the Error Log — so allowlist those origins.
        const _APP_SCRIPT_ORIGINS = ['www.gstatic.com', 'cdn.jsdelivr.net'];
        if (src && src.startsWith('http') && !src.includes(location.hostname) &&
            !_APP_SCRIPT_ORIGINS.some(o => src.includes(o))) return;

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
