// @ts-check
/**
 * client-errors.js — pure ordering + retention logic for the admin Error Log.
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
function _byNewest(a, b) {
    const ms = e => e.timestamp?.toMillis?.() ?? 0;
    return ms(b) - ms(a);
}

/**
 * IDs of resolved records that should be pruned (expired past retention from resolution).
 * @returns {string[]}
 */
export function expiredResolvedIds(resolved, now, retentionMs = CLIENT_ERROR_RETENTION_MS) {
    return resolved.filter(r => isResolvedErrorExpired(r, now, retentionMs)).map(r => r.id);
}

/**
 * Build the ordered list for the Error Log card: every UNRESOLVED record first
 * (newest-first), then up to `resolvedLimit` recent, non-expired resolved records
 * (newest-first). Unresolved records are always listed first; within expected
 * operational volume (< 100 unresolved at once), a backlog of resolved records
 * cannot displace them.
 * @param {Array} unresolved
 * @param {Array} resolved
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
