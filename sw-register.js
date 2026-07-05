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
    // Captured BEFORE registration: whether this page was loaded under SW control. A page's
    // controller is fixed at navigation time — it can only change later via clients.claim()
    // or an update taking over, which is exactly what controllerchange distinguishes below.
    let hadController = !!navigator.serviceWorker.controller;
    let reloadFired   = false;
    navigator.serviceWorker.register('./service-worker.js')
        .then(registration => {
            /** @param {ServiceWorker} w */
            function activate(w) { w.postMessage({ type: 'SKIP_WAITING' }); }
            // Skip the SKIP_WAITING message on first install (waiting but no controller) —
            // the SW self-activates anyway (skipWaiting on install); messaging it is
            // redundant there. The first-install RELOAD suppression is the hadController
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
                // First-install claim: the page went uncontrolled → controlled, but it was
                // just loaded straight from the network, so it already IS the newest
                // version — reloading here double-loaded every brand-new device (and could
                // eat mid-typing login input). The claim only matters for future fetches.
                if (!hadController) { hadController = true; return; }
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
        })
        .catch(e => console.warn('[SW] Registration failed:', e));
}
