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

/** Device flag: the durability request is one-shot, so a refused request is not re-asked
 *  on every page open (and, in a browser that prompts for it, not re-prompted). */
const PERSIST_ASKED_KEY = 'myb_storage_persist_asked';

/**
 * Ask the browser to make this origin's storage DURABLE, once per device.
 *
 * WHY. The pay calculator's figures live in localStorage and nowhere else — never sent to a server,
 * by design — so they are the one thing in this app that cannot be recreated. Without a persistence
 * grant that storage is "best-effort": the browser may evict it under storage pressure, and the
 * member simply finds a year of entries gone. Measured in Chromium: `navigator.storage.persist`
 * exists, `persisted()` is false and the quota is ~820MB, i.e. the data sits in exactly that
 * evictable class today, and nothing has ever asked otherwise.
 *
 * WHY IT IS AN ANDROID FIX SPECIFICALLY. WebKit exposes no `navigator.storage` at all — measured:
 * `persist`, `persisted` and `estimate` are all absent and throw on a secure origin — so on iOS
 * there is nothing to call and installing to the Home Screen is the only lever. On Chromium the API
 * is there, Chrome grants by heuristic (installed / engaged) without a prompt, and this is a real
 * request that can be granted. It protects the whole ORIGIN, so the Firestore cache and the saved
 * session benefit too.
 *
 * WHY IT ASKS ONLY WHEN THERE IS SOMETHING TO LOSE. Firefox (unlike Chrome) shows a permission
 * doorhanger for this, and a first-run visitor with no pay data would meet it having nothing at
 * stake — a prompt that reads as the app asking for something unexplained. Passing the key prefix
 * means the request happens on the first open AFTER the member has saved something, which is both
 * the earliest useful moment and the first moment it can be explained by what they just did.
 *
 * Fire-and-forget: the result changes nothing the member can see, a refusal is not an error, and
 * every branch is wrapped because this whole module exists for browsers that throw on storage.
 *
 * @param {string} keyPrefix only ask once this device holds at least one key starting with it
 * @returns {void}
 */
export function requestPersistentStorage(keyPrefix) {
    try {
        if (!keyPrefix || lsGet(PERSIST_ASKED_KEY)) return;
        if (!lsKeys().some(k => k.startsWith(keyPrefix))) return;   // nothing worth protecting yet
        lsSet(PERSIST_ASKED_KEY, '1');                              // one-shot, before the await
        const s = /** @type {any} */ (navigator).storage;
        if (!s || typeof s.persist !== 'function') return;          // WebKit: no API at all
        s.persist().catch(() => { /* refused or unsupported — nothing to do */ });
    } catch { /* storage unavailable — the member has no saved data here anyway */ }
}
