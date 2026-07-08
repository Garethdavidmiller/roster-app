// @ts-check
/**
 * sw-register.js — Service worker registration and update lifecycle.
 *
 * Shared by all six app pages: calendar-app.js, admin-app.js, paycalc-app.js,
 * operations-app.js, settings-app.js, links-app.js.
 *
 * Pattern: register → activate any waiting worker immediately → listen for
 * future updates → on controllerchange, reload (or call beforeReload).
 * An hourly update check is wired via visibilitychange so it pauses when the
 * tab is hidden and fires immediately on return.
 */

// Once-per-page-life guard (v16.23): coordinators whose init() can be RE-INVOKED (the in-place
// sign-in re-entry on operations/links/paycalc) must not stack a second controllerchange handler
// + a second hourly update interval — each registration call wired its own set.
let _registered = false;

/** TEST-ONLY: reset the once-per-page-life guard between test cases. */
export function _resetForTest() { _registered = false; }

/**
 * Register the service worker and handle the skip-waiting → reload lifecycle.
 *
 * @param {object}   [opts]
 * @param {Function} [opts.beforeReload]  Called instead of window.location.reload().
 *                                        The callback decides if/when to reload.
 * @param {boolean}  [opts.bfcache]       Add pagehide/pageshow handlers to manage
 *                                        the update-check interval across bfcache restore.
 */
export function registerServiceWorker({ beforeReload, bfcache = false } = {}) {
    if (!('serviceWorker' in navigator)) return;
    if (_registered) return;
    _registered = true;
    let reloadFired = false;
    // TRUE first install = no registration existed when the page started (v16.23). The
    // first-install reload suppression used to key on `navigator.serviceWorker.controller`
    // alone — but a HARD RELOAD (or any SW-bypassed load) also leaves controller null while
    // the registration and its active SW still exist. Keying on the controller alone
    // misclassified the NEXT genuine update's controllerchange on such a page as a
    // "first-install claim" and swallowed its reload (and its beforeReload), leaving the tab
    // on old JS against the new SW's version cache for a whole deploy cycle.
    navigator.serviceWorker.getRegistration().catch(() => undefined)
        .then(existing => {
            // First-install claim suppression: the page went uncontrolled → controlled, but it
            // was just loaded straight from the network, so it already IS the newest version —
            // reloading there double-loaded every brand-new device (and could eat mid-typing
            // login input). The claim only matters for future fetches. A hard-reloaded page
            // (existing registration, null controller) does NOT suppress: when a new SW claims
            // it, that is a genuine update and must reload.
            let suppressNextClaim = !existing && !navigator.serviceWorker.controller;
            return navigator.serviceWorker.register('./service-worker.js').then(registration => {
                /** @param {ServiceWorker} w */
                function activate(w) { w.postMessage({ type: 'SKIP_WAITING' }); }
                // Skip the SKIP_WAITING message on first install (waiting but no controller) —
                // the SW self-activates anyway (skipWaiting on install); messaging it is
                // redundant there. The first-install RELOAD suppression is the suppressNextClaim
                // check in the controllerchange handler below — this guard alone never
                // prevented it, because the SW's own install-time skipWaiting + claim fire
                // controllerchange regardless of whether we send the message.
                if (registration.waiting && navigator.serviceWorker.controller) activate(registration.waiting);
                registration.addEventListener('updatefound', () => {
                    const nw = registration.installing;
                    if (!nw) return;
                    nw.addEventListener('statechange', () => {
                        if (nw.state === 'installed' && navigator.serviceWorker.controller) activate(nw);
                    });
                });
                navigator.serviceWorker.addEventListener('controllerchange', () => {
                    if (suppressNextClaim) { suppressNextClaim = false; return; }
                    // Not {once:true}: a beforeReload that declines to reload (links' confirm →
                    // Cancel) must still receive the NEXT update's controllerchange, or that
                    // page silently never updates again. The default path double-fire is
                    // guarded by reloadFired instead.
                    if (beforeReload) { beforeReload(); return; }
                    if (reloadFired) return;
                    reloadFired = true;
                    window.location.reload();
                });
                let updateInterval = setInterval(() => registration.update().catch(() => {}), 60 * 60 * 1000);
                document.addEventListener('visibilitychange', () => {
                    if (document.hidden) clearInterval(updateInterval);
                    else { clearInterval(updateInterval); registration.update().catch(() => {}); updateInterval = setInterval(() => registration.update().catch(() => {}), 60 * 60 * 1000); }
                });
                if (bfcache) {
                    window.addEventListener('pagehide', () => clearInterval(updateInterval));
                    window.addEventListener('pageshow', () => {
                        clearInterval(updateInterval);
                        updateInterval = setInterval(() => registration.update().catch(() => {}), 60 * 60 * 1000);
                    });
                }
            });
        })
        // Release the once-guard on failure (v16.23): _registered latches synchronously, so a
        // transient register() rejection would otherwise leave the page PERMANENTLY without a
        // SW registration — the in-place sign-in re-invocation (the very flow the guard exists
        // for) used to retry it, and still can this way.
        .catch(e => { _registered = false; console.warn('[SW] Registration failed:', e); });
}
