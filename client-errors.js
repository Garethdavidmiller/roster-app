// @ts-check
/**
 * client-errors.js — the pure RULES of the client error log: what gets captured, and how what
 * is captured is ordered and retained.
 *
 * No DOM, no Firebase: this is the "humble object" core of getClientErrors() in
 * firebase-client.js, split out so the policy (which errors show, in what order,
 * which get pruned) is unit-testable without the Firestore SDK. firebase-client.js
 * keeps only the I/O (the two queries + the deletes). Tested by client-errors.test.mjs.
 *
 * Records are plain objects shaped like a Firestore doc: { id, resolved, timestamp,
 * resolvedAt }, where timestamp/resolvedAt are Firestore Timestamps (a `.toMillis()`
 * method) or absent. The helpers only ever call `.toMillis?.()`, so any object with
 * that shape works — which is exactly what makes them testable.
 */

/** Origins the app's OWN dependencies load from — a crash inside those is a real failure. */
export const APP_SCRIPT_ORIGINS = ['www.gstatic.com', 'cdn.jsdelivr.net'];

/**
 * PURE: should this error reach the Error Log? Extracted from `_report` (v19.20) so the noise
 * filters are unit-testable.
 *
 * They were not, and that is the wrong way round for this particular code: a filter that is too
 * NARROW merely leaves noise in the log, which is visible and annoying; a filter that is too BROAD
 * silently swallows real errors, and nothing ever tells you. The failure mode is invisible by
 * construction, so it needs tests more than most code, not fewer.
 *
 * @param {string} message trimmed error message
 * @param {string} src     source URL (window.onerror) or the current pathname
 * @param {string} hostname `location.hostname`
 * @returns {boolean} true → write it to Firestore
 */
export function shouldReport(message, src, hostname) {
    // Cross-origin script errors arrive as the literal string "Script error." with no useful
    // stack — useless and very frequent from browser extensions.
    if (!message || message === 'Script error.') return false;

    // Chrome fires this for layout side-effects of third-party content; cosmetic, unactionable.
    if (message.includes('ResizeObserver loop')) return false;

    // Browsers emit these from the DECLARATIVE cross-document view transition the app opts into
    // (`@view-transition { navigation: auto }` in shared.css) whenever they abandon a transition.
    // Not thrown app code (no stack; the app makes no startViewTransition() call).
    //
    // TWO MESSAGES, ONE CAUSE (the second added v22.67, from a live report on Android Chrome 152).
    // The first is Chromium's own worded skip; the second is the DOMException it rejects the
    // transition promise with when the document stops being fully active mid-navigation — a tap
    // through to another page, the app switcher, a back gesture. There is no promise for the app to
    // handle, because the app never asked for the transition: the CSS did. So it surfaces as an
    // unhandled rejection here, and the navigation it names has already completed correctly.
    //
    // MATCHED IN FULL, not on a fragment. "Transition was aborted" alone would also swallow any
    // future overlay or animation failure the app might genuinely want to see, and this log's
    // recorded failure direction is the filter that is too broad.
    //
    // A THIRD WORDING, SAME CAUSE (v23.03, live report — paycalc.html, Android Edge 152, 6 Sep
    // 2026). This is the DOMException Chromium rejects with when the transition is SKIPPED rather
    // than aborted; the v22.67 pair does not match it, so it reached the log on a device already
    // carrying that filter. The three arrive from the same declarative opt-in and mean the same
    // thing to a member: nothing. The navigation they name completed correctly.
    if (message.includes('Skipping view transition')) return false;
    if (message.includes('Transition was aborted because of invalid state')) return false;
    // ANCHORED, NOT A SUBSTRING, AND THE TEST CAUGHT THE FIRST TRY. Chromium's message is the whole
    // string — bare, or behind its error name — so a plain `includes` also swallows
    // "Transition was skipped by the overlay because it never opened", which is an app fault in a
    // real lightbox. `skip` is an ordinary word this app uses about real things (a skipped save, a
    // skipped roster row), so this one rule earns an anchor where the two above are distinctive
    // enough not to need one.
    if (/(^|:\s*)Transition was skipped\.?$/.test(message.trim())) return false;

    // Chrome emits this as an unhandled rejection when its own background SW-update check fails on
    // a network blip. Only suppress alongside a recognised network phrase — a genuine SW
    // installation failure (a script that cannot be parsed) is worded differently and must log.
    if (message.includes('Failed to update a ServiceWorker') &&
        (message.includes('net::') || message.includes('NetworkError') ||
         message.includes('Failed to fetch') || message.includes('Load failed'))) return false;

    // WebKit tears down IndexedDB connections when it suspends or reclaims a page — backgrounding
    // the PWA, screen lock, the app switcher, memory pressure. Firebase Auth's indexedDBLocalPersistence
    // POLLS its object store on an interval (Safari's storage events are unreliable across tabs), so
    // a poll landing in that window throws from deep inside the SDK with no app frame on the stack.
    // Firebase wraps it in `_withRetries` precisely because it expects this; when the retries are
    // spent the rejection escapes to us. The identity is already restored by then and the connection
    // reopens on the next foreground, so it is environmental noise — but it recurs on every iPhone.
    //
    // Scoped to the SDK on purpose. The same phrases from OUR OWN origin would mean the Firestore
    // persistent cache is failing, which is a real fault worth seeing, so those still log.
    if (_IDB_TEARDOWN.some(p => message.includes(p)) &&
        APP_SCRIPT_ORIGINS.some(o => src.includes(o))) return false;

    // Browser extensions inject scripts under their own URL scheme. Matched EXPLICITLY rather than
    // by "not http", because an unhandledrejection passes `location.pathname` (e.g. "/index.html"),
    // which is also not http — a blanket non-http rule would silently swallow every rejection the
    // app makes, which is most of what this log is for.
    if (/^(?:chrome|moz|safari|ms-browser)-extension:\/\//.test(src)) return false;

    // Errors whose source URL is a different origin usually belong to extensions or injected
    // scripts — out of scope. But the app's own dependencies load from CDNs, and a crash inside
    // those is a genuine app-breaking failure that must reach the Error Log.
    if (src && src.startsWith('http') && !src.includes(hostname) &&
        !APP_SCRIPT_ORIGINS.some(o => src.includes(o))) return false;

    return true;
}

/** WebKit's transient IndexedDB teardown/instability messages. Exact phrases, never a bare "IDB". */
const _IDB_TEARDOWN = [
    'The database connection is closing',
    'Connection to Indexed Database server lost',
    'An internal error was encountered in the Indexed Database server',
];

/** Retention window for resolved records (ms) — measured from RESOLUTION, not the error time. */
export const CLIENT_ERROR_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * True if a resolved record is past the retention window, measured from when it was
 * resolved. Records with no `resolvedAt` (resolved before the field existed) are never
 * expired — they are left alone rather than guessed at.
 * @param {{resolved?: boolean, resolvedAt?: {toMillis?: () => number}}} rec
 * @param {number} now - Date.now()
 * @param {number} [retentionMs]
 */
export function isResolvedErrorExpired(rec, now, retentionMs = CLIENT_ERROR_RETENTION_MS) {
    const ms = rec.resolvedAt?.toMillis?.();
    return rec.resolved === true && typeof ms === 'number' && (now - ms) > retentionMs;
}

/** Newest-first comparator on a record's `timestamp` (the time the error occurred). */
function _byNewest(/** @type {any} */ a, /** @type {any} */ b) {
    const ms = (/** @type {any} */ e) => e.timestamp?.toMillis?.() ?? 0;
    return ms(b) - ms(a);
}

/**
 * IDs of resolved records that should be pruned (expired past retention from resolution).
 * @param {any[]} resolved
 * @param {number} now
 * @returns {string[]}
 */
export function expiredResolvedIds(resolved, now, retentionMs = CLIENT_ERROR_RETENTION_MS) {
    return resolved.filter((/** @type {any} */ r) => isResolvedErrorExpired(r, now, retentionMs)).map((/** @type {any} */ r) => r.id);
}

/**
 * Build the ordered list for the Error Log card: every UNRESOLVED record first
 * (newest-first), then up to `resolvedLimit` recent, non-expired resolved records
 * (newest-first). Unresolved records are always listed first; within expected
 * operational volume (< 100 unresolved at once), a backlog of resolved records
 * cannot displace them.
 * @param {any[]} unresolved
 * @param {any[]} resolved
 * @param {number} now
 * @param {{retentionMs?: number, resolvedLimit?: number}} [opts]
 */
export function orderClientErrors(unresolved, resolved, now, { retentionMs = CLIENT_ERROR_RETENTION_MS, resolvedLimit = 30 } = {}) {
    const u = [...unresolved].sort(_byNewest);
    const r = resolved
        .filter(x => !isResolvedErrorExpired(x, now, retentionMs))
        .sort(_byNewest)
        .slice(0, resolvedLimit);
    return [...u, ...r];
}

/**
 * Split the over-fetched unresolved rows into the shown set + a truncation flag (extracted from
 * getClientErrors, v18.28, so the no-silent-caps logic is unit-tested). getClientErrors deliberately
 * fetches `cap + 1` rows so a (cap+1)th row PROVES "> cap exist" — a plain `limit(cap)` can't tell
 * "exactly cap" from "cap+". Returns the first `cap` rows and whether more genuinely exist (so the
 * card can show a "showing the first N" banner rather than silently hiding the overflow).
 * @template T
 * @param {T[]} fetchedUnresolved  rows fetched with `limit(cap + 1)`
 * @param {number} cap
 * @returns {{ shown: T[], truncated: boolean }}
 */
export function capUnresolvedErrors(fetchedUnresolved, cap) {
    return { shown: fetchedUnresolved.slice(0, cap), truncated: fetchedUnresolved.length > cap };
}
