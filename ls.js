// @ts-check
// Safe localStorage wrappers — iOS Safari private mode throws SecurityError on any access.
// Imported by calendar-app.js, admin-app.js, paycalc-app.js, settings-app.js, notif.js, session.js, paycalc-migrations.js.
let _lsWarnFired = false;
/** @param {any} err */
function _warnOnce(err) {
    if (_lsWarnFired) return;
    _lsWarnFired = true;
    console.warn('[ls] localStorage unavailable (private browsing?):', err?.message || err);
}
/** @param {string} k */
export function lsGet(k)    { try { return localStorage.getItem(k); }    catch(e) { _warnOnce(e); return null; } }
/** @param {string} k @param {any} v */
export function lsSet(k, v) { try { localStorage.setItem(k, v); }        catch(e) { _warnOnce(e); } }
/** @param {string} k */
export function lsDel(k)    { try { localStorage.removeItem(k); }        catch(e) { _warnOnce(e); } }
/**
 * A localStorage write whose SUCCESS is verified, for the one case where `lsSet`'s forgiveness is
 * the wrong behaviour: a MOVE — write the new key, then delete the old one.
 *
 * `lsSet` swallows the exception on purpose. iOS private mode, a full quota and a locked-down
 * browser all throw on any access, and a preference that fails to save is not worth crashing a page
 * over. But a migration reads that silence as success and then deletes the source, so a single
 * failed write destroys the only copy — permanently, and with a completion marker written on top so
 * it is never retried. Reproduced by an external audit against the CEA-code and namespace
 * migrations (Aug 2026): both left the old key gone, the new key absent, and migration recorded as
 * done.
 *
 * So this one reads the value BACK. Not because `setItem` lies, but because the layer above it is
 * built to say nothing when it fails, and a destructive caller needs an answer rather than a
 * silence. It is the same discipline `paycalc-transfer-card.js` already applies to restore — the
 * repo had the right instinct in one place and not the other.
 *
 * Deliberately NOT the default: changing `lsSet` globally would make ~200 ordinary preference
 * writes throw or branch for a case that only matters when something is about to be deleted.
 *
 * @param {string} k
 * @param {any} v
 * @returns {boolean} true only if the value was stored AND reads back identical
 */
export function lsSetVerified(k, v) {
    const want = String(v);
    try {
        localStorage.setItem(k, want);
        return localStorage.getItem(k) === want;
    } catch (e) { _warnOnce(e); return false; }
}

/**
 * Move a value between keys, deleting the source ONLY once the destination is verified.
 *
 * The invariant, and the whole point of the function: **never delete source data until the
 * destination has been read back**. A caller that cannot move the value keeps BOTH sides — the old
 * key stays, so the migration can run again on a later load when storage is working.
 *
 * @param {string} fromKey
 * @param {string} toKey
 * @param {string|null} [value]  what to write (defaults to the source's current value)
 * @returns {boolean} true if the destination now holds the value and the source has been removed
 */
export function lsMove(fromKey, toKey, value) {
    const v = value === undefined ? lsGet(fromKey) : value;
    if (v === null) return false;                 // nothing to move
    if (!lsSetVerified(toKey, v)) return false;   // destination not safe — keep the source
    lsDel(fromKey);
    return true;
}

/** Snapshot of all localStorage key names (empty array if storage is unavailable).
 *  Uses the standard length/key(i) enumeration so it never clashes with object
 *  methods, and returns a snapshot so callers can safely delete keys while iterating. */
export function lsKeys() {
    try {
        const out = [];
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k !== null) out.push(k);
        }
        return out;
    } catch(e) { _warnOnce(e); return []; }
}
