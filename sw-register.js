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
// Latches TRUE once the single page-life controllerchange listener is attached, and — unlike
// `_registered` — is NEVER reset on a register() failure (review B3). `_registered` resets in the
// .catch so the in-place-login re-invocation can RETRY registration; but the controllerchange listener
// is attached BEFORE register() (v16.88 first-install race fix), so without this a retry stacked a
// SECOND listener — each with its own beforeReload closure, firing a DOUBLE "reload?" confirm on the
// next SW update (links/paycalc). The listener needs attaching exactly once per page life.
let _controllerListenerAttached = false;

/** TEST-ONLY: reset the once-per-page-life guards between test cases. */
export function _resetForTest() { _registered = false; _controllerListenerAttached = false; }

/**
 * Register the service worker and handle the skip-waiting → reload lifecycle.
 *
 * @param {object}   [opts]
 * @param {Function} [opts.beforeReload]  Called instead of window.location.reload().
 *                                        The callback decides if/when to reload.
 * @param {boolean}  [opts.bfcache]       Add pagehide/pageshow handlers to manage
 *                                        the update-check interval across bfcache restore.
 * @param {boolean}  [opts.deferWhileVisible] Hold an update's reload until the page is hidden,
 *                                        so a release never takes the page away mid-read. Opt-in;
 *                                        see the controllerchange handler for why only the
 *                                        Calendar uses it.
 */
export function registerServiceWorker({ beforeReload, bfcache = false, deferWhileVisible = false } = {}) {
    if (!('serviceWorker' in navigator)) return;
    if (_registered) return;
    _registered = true;
    let reloadFired = false;
    // `deferWhileVisible` state: the update that is waiting for the member to look away, and
    // whether the one-shot listener that will run it has been attached.
    let pendingReload = /** @type {null | (() => void)} */ (null);
    let hiddenHookAttached = false;
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
            // Attach the controllerchange listener BEFORE register() (v16.88 — first-install race
            // fix). Attached inside register().then (as it was), a very fast first-install claim
            // could fire its controllerchange in the microtask gap AFTER register() resolves but
            // BEFORE the listener existed — the claim would be MISSED, suppressNextClaim would stay
            // unconsumed, and the NEXT genuine update's controllerchange would then be wrongly
            // suppressed (leaving the device on old JS against the new SW's cache for a whole deploy
            // cycle). Registering it here — before register() is even called — guarantees the FIRST
            // controllerchange (the first-install claim) is the event that consumes the flag. The
            // handler needs no `registration` reference, so the earlier attach is behaviour-neutral
            // for every other path. Not {once:true}: a beforeReload that declines to reload (links'
            // confirm → Cancel) must still receive the NEXT update's controllerchange, or that page
            // silently never updates again. The default path double-fire is guarded by reloadFired.
            if (!_controllerListenerAttached) {
                _controllerListenerAttached = true;
                navigator.serviceWorker.addEventListener('controllerchange', () => {
                    if (suppressNextClaim) { suppressNextClaim = false; return; }
                    const run = () => {
                        if (beforeReload) { beforeReload(); return; }
                        if (reloadFired) return;
                        reloadFired = true;
                        window.location.reload();
                    };
                    // ── A RELEASE MUST NOT TAKE THE PAGE AWAY WHILE SOMEBODY IS READING IT ──────
                    //
                    // An update reloads, and that is right: it is how a device stops running old JS
                    // against the new SW's version cache. What was wrong is WHEN. This app shipped
                    // 62 releases in the 14 days to 5 Sep 2026 — 17 on one day — and each one claims
                    // the moment it installs, so a member with the Calendar open watched their
                    // roster vanish and rebuild, paying a second full boot INCLUDING the auth round
                    // trip that `LATENCY_PLAN.md` measures as the wall. It reads as "the calendar is
                    // slow", and the latency instrumentation cannot see it: a reload is recorded as
                    // one more page-load sample, so the ladder shows two ordinary loads rather than
                    // one member interrupted.
                    //
                    // So the reload waits for the member to look away. On a phone that is seconds —
                    // locking the screen or switching apps both fire it — and they come back to a
                    // page that is already new. If they never look away they keep a working page on
                    // the old version until they navigate, which is the correct trade: the update is
                    // not urgent, and interrupting them is what caused the complaint.
                    //
                    // OPT-IN, and the Calendar is the only caller. The pages that ask before
                    // reloading (admin, operations, links) are asking because a member may have
                    // unsaved work, and deferring THAT question until they background the app would
                    // greet them with a confirm dialog on return. Their behaviour is untouched.
                    //
                    // Already hidden ⇒ run now: nobody is watching, which is the whole condition.
                    if (deferWhileVisible && document.visibilityState === 'visible') {
                        pendingReload = run;   // a second update supersedes the first; one reload serves both
                        if (!hiddenHookAttached) {
                            hiddenHookAttached = true;
                            document.addEventListener('visibilitychange', () => {
                                if (document.visibilityState !== 'hidden') return;
                                const fn = pendingReload;
                                pendingReload = null;
                                if (fn) fn();
                            });
                        }
                        return;
                    }
                    run();
                });
            }
            return navigator.serviceWorker.register('./service-worker.js').then(registration => {
                /** @param {ServiceWorker} w */
                function activate(w) { w.postMessage({ type: 'SKIP_WAITING' }); }
                // Skip the SKIP_WAITING message on first install (waiting but no controller) —
                // the SW self-activates anyway (skipWaiting on install); messaging it is
                // redundant there. The first-install RELOAD suppression is the suppressNextClaim
                // check in the controllerchange handler above — this guard alone never
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
                let updateInterval = setInterval(() => registration.update().catch(() => {}), 60 * 60 * 1000);
                document.addEventListener('visibilitychange', () => {
                    if (document.hidden) clearInterval(updateInterval);
                    else { clearInterval(updateInterval); registration.update().catch(() => {}); updateInterval = setInterval(() => registration.update().catch(() => {}), 60 * 60 * 1000); }
                });
                if (bfcache) {
                    window.addEventListener('pagehide', () => clearInterval(updateInterval));
                    window.addEventListener('pageshow', () => {
                        clearInterval(updateInterval);
                        // Check immediately on bfcache restore (mirrors the visibilitychange path) —
                        // otherwise a restored tab waits up to a full hour for the next check.
                        registration.update().catch(() => {});
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
