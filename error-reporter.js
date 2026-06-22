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
        const message = (err instanceof Error ? err.message : String(err ?? '')).trim();

        // Cross-origin script errors arrive as the literal string "Script error."
        // with no useful stack — useless and very frequent from browser extensions.
        if (!message || message === 'Script error.') return;

        // Chrome fires this for layout side-effects of third-party content; it is
        // cosmetic and cannot be acted on.
        if (message.includes('ResizeObserver loop')) return;

        // Errors whose source URL is a different origin belong to extensions or
        // injected scripts — out of scope for this app.
        if (src && src.startsWith('http') && !src.includes(location.hostname)) return;

        // One report per distinct message per page session — don't flood Firestore if
        // the same bug fires on every keypress or scroll event.
        const dedupKey = message.slice(0, 120);
        if (_seen.has(dedupKey)) return;
        _seen.add(dedupKey);

        const stack      = (err instanceof Error ? (err.stack ?? '') : '').slice(0, 800);
        const memberName = lsGet(AUTH_KEY)?.name ?? 'unknown';
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
