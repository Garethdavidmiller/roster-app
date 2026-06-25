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
    navigator.serviceWorker.register('./service-worker.js')
        .then(registration => {
            function activate(w) { w.postMessage({ type: 'SKIP_WAITING' }); }
            if (registration.waiting) activate(registration.waiting);
            registration.addEventListener('updatefound', () => {
                const nw = registration.installing;
                if (!nw) return;
                nw.addEventListener('statechange', () => {
                    if (nw.state === 'installed' && navigator.serviceWorker.controller) activate(nw);
                });
            });
            navigator.serviceWorker.addEventListener('controllerchange', () => {
                beforeReload ? beforeReload() : window.location.reload();
            }, { once: true });
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
