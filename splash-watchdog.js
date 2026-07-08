// @ts-check
// splash-watchdog.js — CLASSIC (non-module) recovery script for index.html only.
//
// Loaded as a plain `<script defer src>` (NOT `type="module"`), so it is INDEPENDENT of the
// app's ES-module graph. That is the whole point: the only code that removes the launch splash
// lives inside calendar-app.js (on first render, or in its own catch) — so if the module graph
// fails to LOAD (a failed gstatic Firebase-SDK import, a corrupt/mixed/stale service-worker
// cache, or any broken module), calendar-app.js never runs, its catch never fires, and the
// splash stays up FOREVER with no recovery. This watchdog runs regardless and gives a stuck
// launch a way out: one guarded auto-reload, then a manual Reload / Reset-cache panel.
//
// CSP note: `script-src 'self'` forbids inline scripts, so this must be a same-origin file, not
// an inline block. Runtime-only (guarded on `document`) so importing it in tests is a no-op.
(function () {
    'use strict';
    if (typeof document === 'undefined') return;   // test/SSR context — no splash to watch

    var TIMEOUT_MS = 20000;                 // splash clears within ~1-2s once JS runs. 20s (not 10s): a genuine
                                            // FIRST install over poor mobile can take >10s to fetch ~400 KB of
                                            // gstatic SDK + the module graph — a 10s window auto-reloaded a healthy
                                            // slow load and then showed a false "stale copy" panel (v16.19)
    var RELOAD_KEY = 'myb_splash_reloaded'; // sessionStorage guard: AT MOST one auto-reload per launch (no loop)

    setTimeout(function () {
        var splash = document.getElementById('splash');
        // App started normally → calendar-app.js already removed the splash, OR added `.hidden`
        // and is mid fade-out (removed on transitionend / a 1s fallback). Either way, not stuck.
        if (!splash || !document.body.contains(splash) || splash.classList.contains('hidden')) return;

        // First stuck detection this session: try ONE reload — it picks up a freshly-deployed SW
        // and re-runs the module load (fixes the common mid-deploy-transition case with zero
        // friction). Guarded so it can NEVER loop: only reload if we successfully recorded the
        // flag; if sessionStorage is unavailable (iOS private mode) skip straight to the panel.
        var canReload = false;
        try {
            if (!sessionStorage.getItem(RELOAD_KEY)) {
                sessionStorage.setItem(RELOAD_KEY, '1');
                canReload = true;   // flag recorded → safe to auto-reload exactly once
            }
        } catch (_e) { /* sessionStorage unavailable → don't auto-reload (can't guard the loop) */ }
        if (canReload) { location.reload(); return; }

        showRecovery(splash);
    }, TIMEOUT_MS);

    /** Replace the splash with a self-contained recovery panel. Inline styles (so it renders even
     *  if index.css never loaded) and textContent only (no injection surface). */
    function showRecovery(/** @type {HTMLElement} */ splash) {
        while (splash.firstChild) splash.removeChild(splash.firstChild);
        splash.setAttribute('aria-hidden', 'false');
        splash.setAttribute('role', 'alertdialog');
        splash.style.background = '#001e3c';   // navy fallback if index.css didn't load
        splash.style.pointerEvents = 'auto';

        var title = document.createElement('div');
        title.textContent = 'Marylebone Roster couldn’t finish loading';
        title.style.cssText = 'font:600 18px/1.3 system-ui,-apple-system,sans-serif;color:#fff;text-align:center;margin-bottom:8px';

        var sub = document.createElement('div');
        // Neutral wording: by the time this panel shows we've already tried one auto-reload, so
        // the cause could be a slow network OR a stale/broken cache — don't assert "stale copy"
        // (factually wrong for a first install that has no cache yet). Reload / Reset cover both.
        sub.textContent = 'The app took too long to start. Try reloading.';
        sub.style.cssText = 'font:14px/1.4 system-ui,-apple-system,sans-serif;color:#fff;opacity:.8;text-align:center;max-width:280px;margin-bottom:22px';

        var reloadBtn = document.createElement('button');
        reloadBtn.type = 'button';
        reloadBtn.textContent = 'Reload';
        reloadBtn.style.cssText = 'font:600 16px system-ui,-apple-system,sans-serif;padding:12px 30px;border:0;border-radius:10px;background:#f5c800;color:#001e3c;cursor:pointer;margin-bottom:14px';
        reloadBtn.addEventListener('click', function () { location.reload(); });

        var resetBtn = document.createElement('button');
        resetBtn.type = 'button';
        resetBtn.textContent = 'Still stuck? Reset the app (clears the cache)';
        resetBtn.style.cssText = 'font:13px system-ui,-apple-system,sans-serif;padding:8px 16px;border:0;background:transparent;color:#fff;opacity:.85;text-decoration:underline;cursor:pointer';
        resetBtn.addEventListener('click', function () {
            resetBtn.disabled = true;
            resetBtn.textContent = 'Resetting…';
            resetApp();
        });

        var wrap = document.createElement('div');
        wrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;padding:24px;box-sizing:border-box';
        wrap.appendChild(title);
        wrap.appendChild(sub);
        wrap.appendChild(reloadBtn);
        wrap.appendChild(resetBtn);
        splash.appendChild(wrap);
    }

    /** Nuclear cache clear: unregister every service worker + delete every cache, clear the
     *  reload guard, then reload. Resolves the stale/broken-cache cause without the user needing
     *  to hunt through OS app-storage settings. Best-effort — always reloads even if a step fails. */
    function resetApp() {
        var done = false;
        var reload = function () {
            if (done) return;               // race guard: fire the reload exactly once
            done = true;
            try { sessionStorage.removeItem(RELOAD_KEY); } catch (_e) { /* ignore */ }
            location.reload();
        };
        // Guarantee a reload even if a SW/cache op HANGS (never settles) — the wedged-storage
        // state this last-resort recovery targets. Promise.all only settles when EVERY job
        // settles; a hung getRegistrations()/caches.keys() would otherwise leave the button on
        // "Resetting…" forever with no path forward. A .catch only handles a rejection, not a
        // hang, so we need a real timeout race (v16.19).
        setTimeout(reload, 4000);
        var jobs = [];
        if ('serviceWorker' in navigator) {
            jobs.push(navigator.serviceWorker.getRegistrations()
                .then(function (regs) { return Promise.all(regs.map(function (r) { return r.unregister(); })); })
                .catch(function () { /* ignore */ }));
        }
        if ('caches' in window) {
            jobs.push(caches.keys()
                .then(function (keys) { return Promise.all(keys.map(function (k) { return caches.delete(k); })); })
                .catch(function () { /* ignore */ }));
        }
        Promise.all(jobs).then(reload, reload);
    }
})();
