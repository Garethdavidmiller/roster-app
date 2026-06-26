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
