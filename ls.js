// Safe localStorage wrappers — iOS Safari private mode throws SecurityError on any access.
// Imported by app.js, admin-app.js, and paycalc.js.
let _lsWarnFired = false;
function _warnOnce(err) {
    if (_lsWarnFired) return;
    _lsWarnFired = true;
    console.warn('[ls] localStorage unavailable (private browsing?):', err?.message || err);
}
export function lsGet(k)    { try { return localStorage.getItem(k); }    catch(e) { _warnOnce(e); return null; } }
export function lsSet(k, v) { try { localStorage.setItem(k, v); }        catch(e) { _warnOnce(e); } }
export function lsDel(k)    { try { localStorage.removeItem(k); }        catch(e) { _warnOnce(e); } }
