// Safe localStorage wrappers — iOS Safari private mode throws SecurityError on any access.
// Imported by app.js, admin-app.js, and paycalc.js.
export function lsGet(k)    { try { return localStorage.getItem(k); }    catch { return null; } }
export function lsSet(k, v) { try { localStorage.setItem(k, v); }        catch {} }
export function lsDel(k)    { try { localStorage.removeItem(k); }        catch {} }
