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
// ── IT WATCHES THE PAGE, NOT THE SPLASH (v20.80) ────────────────────────────────────────────────
//
// It used to stand down the instant the splash was gone or fading, which was right when the splash
// was the only thing between a launch and the Calendar. It is not any more. `calendar-app.js`
// dismisses the splash at module-execution time — deliberately, so a locked visitor is not trapped
// behind a loading screen — while the ACCESS DECISION resolves later and asynchronously. So the
// page can reach a state this watchdog treated as healthy (splash gone) and yet show nothing at
// all: no roster, no unlock card, no error. The retirement condition was exactly the moment the
// risky window opened.
//
// The question is therefore "is anything usable on screen?", and the answer is any ONE of: the
// splash gone AND the Calendar rendered, or an unlock/sign-in card up, or the member's own stored
// roster up, or an error banner showing. The boot skeleton is deliberately NOT on that list — at 20s
// a skeleton is a load that has failed, which is the whole point of the check.
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

    /** Is there anything on screen the member can actually use or act on? */
    function pageIsUsable() {
        // The unlock card, the member sign-in card, or the re-lock card — every one of them is a
        // working page with a next step on it.
        if (document.getElementById('calendarLock')) return true;
        // The member's own stored roster (`calendarSnapshot`): their real shifts, labelled as the
        // stored copy and painted before the access decision (CALENDAR_DATA.md 17). It is the answer
        // the member came for, not a failed load, so reloading over it and then covering it with the
        // recovery panel would take it away. Unlike the skeleton, it carries data.
        if (document.getElementById('calendarSnapshot')) return true;
        // An error banner: not a happy outcome, but it is calendar-app.js's own catch reporting,
        // which means the app ran. Reloading over the top of it would hide the message.
        var banner = document.getElementById('errorBanner');
        if (banner && banner.classList.contains('visible')) return true;
        // The Calendar itself. `firstElementChild` rather than a class name: the renderer owns its
        // markup and this file must not have an opinion about it.
        var display = document.getElementById('calendarDisplay');
        return !!(display && display.firstElementChild);
    }

    // ── 20 SECONDS OF THE PAGE BEING SEEN, NOT 20 SECONDS FROM LOAD (7 Nov 2026, iPhone audit) ──────
    //
    // One timer used to run from load whatever the page was doing, and a page that is not on screen
    // cannot finish loading here: the Calendar takes its splash down inside a requestAnimationFrame
    // (calendar-app.js), and a hidden page runs no frames. That is an ordinary state, not a rare one.
    // An update reloads the Calendar WHILE it is hidden, on purpose (`reloadWhileHidden`,
    // sw-register.js), and a member can switch away during a cold launch — so somebody coming back
    // more than 20s later met a reload they had not asked for or, once the session's one reload was
    // spent, a flash of the recovery panel over a page that was fine.
    //
    // So a page hidden when its window ends, or hidden at any time since the window began, is not
    // judged: the next time it is looked at, a fresh 20s window starts from that moment. A HEALTHY
    // verdict is taken whenever it is true — it reloads nothing and covers nothing — so only the
    // stuck verdict waits for a page that has been on screen for the whole of its window.
    //
    // A HEALTHY CHECK GIVES THE RELOAD BACK, so "one reload" means one per STUCK LAUNCH. It meant one
    // per tab: the flag was set by the first stuck launch and never cleared, so every later stuck
    // launch in that tab skipped the reload that would have fixed it and went straight to the panel.
    // The loop guard is unchanged — a launch that is still stuck after its reload finds the flag.
    var timer = 0;
    var hiddenInWindow = false;   // hidden at any time since the current window began
    var waiting = false;          // a window ended while hidden; the next look starts a fresh one
    var done = false;             // healthy, reloaded or showing the panel — nothing left to judge

    /** Start a fresh window from now. */
    function arm() {
        waiting = false;
        hiddenInWindow = document.visibilityState === 'hidden';
        clearTimeout(timer);
        timer = setTimeout(check, TIMEOUT_MS);
    }

    /** A page looked away from is marked; a page looked at again after that gets a fresh window. */
    function onVisibility() {
        if (done) return;
        if (document.visibilityState === 'hidden') { hiddenInWindow = true; return; }
        if (waiting || hiddenInWindow) arm();
    }

    /** Healthy: stop watching, and give the session its one reload back. */
    function standDown() {
        done = true;
        clearTimeout(timer);
        document.removeEventListener('visibilitychange', onVisibility);
        try { sessionStorage.removeItem(RELOAD_KEY); } catch (_e) { /* unavailable — nothing was stored */ }
    }

    /** The end of a window. */
    function check() {
        if (done) return;
        var splash = document.getElementById('splash');
        var splashUp = !!(splash && document.body.contains(splash) && !splash.classList.contains('hidden'));
        // Healthy: the splash has gone AND something usable replaced it. Either half alone is not
        // enough — a splash still up is the original stuck launch, and a splash gone with an empty
        // page is the one this check was blind to until v20.80.
        if (!splashUp && pageIsUsable()) { standDown(); return; }

        // Not seen for the whole window, so not judged (the note above).
        if (document.visibilityState === 'hidden') { waiting = true; return; }
        if (hiddenInWindow) { arm(); return; }   // looked away and back again: the window runs from now

        // First stuck detection this launch: try ONE reload — it picks up a freshly-deployed SW
        // and re-runs the module load (fixes the common mid-deploy-transition case with zero
        // friction). Guarded so it can NEVER loop: only reload if we successfully recorded the
        // flag; if sessionStorage is unavailable (iOS private mode) skip straight to the panel.
        done = true;
        document.removeEventListener('visibilitychange', onVisibility);
        var canReload = false;
        try {
            if (!sessionStorage.getItem(RELOAD_KEY)) {
                sessionStorage.setItem(RELOAD_KEY, '1');
                canReload = true;   // flag recorded → safe to auto-reload exactly once
            }
        } catch (_e) { /* sessionStorage unavailable → don't auto-reload (can't guard the loop) */ }
        if (canReload) { location.reload(); return; }

        showRecovery(splash);
    }

    document.addEventListener('visibilitychange', onVisibility);
    arm();

    /** Replace the splash with a self-contained recovery panel — or BUILD one where the splash has
     *  already gone, which is the blank-page case (v20.80). Inline styles (so it renders even if
     *  index.css never loaded) and textContent only (no injection surface).
     *  @param {HTMLElement|null} splash */
    function showRecovery(splash) {
        // The splash was dismissed and nothing usable arrived. Recreate the same full-screen
        // surface rather than appending to a page whose layout we cannot rely on: the fixed inset
        // is what makes this readable regardless of what did or did not render underneath.
        if (!splash || !document.body.contains(splash)) {
            splash = document.createElement('div');
            splash.id = 'splash';
            splash.style.cssText = 'position:fixed;inset:0;z-index:9999';
            document.body.appendChild(splash);
        }
        while (splash.firstChild) splash.removeChild(splash.firstChild);
        splash.classList.remove('hidden');
        splash.setAttribute('aria-hidden', 'false');
        // An alertdialog NAMED from its title and holding focus (Nov 2026): the role alone was
        // switched on an element that had been on the page all along, the case a screen reader is
        // least likely to announce, so a member who cannot see it could be left on a silent page.
        splash.setAttribute('role', 'alertdialog');
        splash.setAttribute('aria-modal', 'true');
        splash.setAttribute('aria-labelledby', 'splashRecoveryTitle');
        splash.setAttribute('aria-describedby', 'splashRecoveryText');
        splash.style.background = '#001e3c';   // navy fallback if index.css didn't load
        splash.style.pointerEvents = 'auto';
        splash.style.opacity = '1';            // whatever hid it, it is being reused now

        var title = document.createElement('div');
        title.id = 'splashRecoveryTitle';
        title.textContent = 'Marylebone Roster couldn’t finish loading';
        title.style.cssText = 'font:600 18px/1.3 system-ui,-apple-system,sans-serif;color:#fff;text-align:center;margin-bottom:8px';

        var sub = document.createElement('div');
        sub.id = 'splashRecoveryText';
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
        resetBtn.textContent = 'Still stuck? Reset the app (start fresh)';
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
        // Focus moves INTO the dialog, on its first action — what opening an alertdialog means, and
        // what makes a screen reader read the name and the description above.
        try { reloadBtn.focus(); } catch (_e) { /* nothing focusable here — the panel still shows */ }
    }

    /** THIS APP's cache clear: unregister the service workers that serve this app, delete the
     *  caches this app owns, clear the reload guard, then reload. Resolves the stale/broken-cache
     *  cause without the user needing to hunt through OS app-storage settings. Best-effort —
     *  always reloads even if a step fails.
     *
     *  SCOPED, not origin-wide (v21.86, external audit). It used to unregister EVERY service worker
     *  registration and delete EVERY Cache Storage entry on the origin. On a dedicated origin that
     *  is merely blunt; the GitHub Pages mirror is not one — `garethdavidmiller.github.io` can host
     *  any number of other pages, and a member tapping "Reset app" there would take out an
     *  unrelated app's offline data with no warning and no way back. The recovery is the same
     *  either way: what breaks this app is this app's own stale cache.
     *
     *  Both filters FAIL OPEN in the direction of doing LESS, which is the right way round for a
     *  destructive action: an unreadable scope or an unexpected cache name is left alone. The cost
     *  is a reset that occasionally does not clear everything; the alternative cost is deleting
     *  somebody else's data.
     *
     *  The SW filter matches the SCRIPT, not the scope (v21.96, external review). "Scope is a
     *  prefix of our directory" was the right shape and one step too loose: a ROOT scope (`/`) is a
     *  prefix of `/roster-app/` by definition, so another app's root-scoped worker on the Pages
     *  origin satisfied it and was unregistered — the exact case the v21.86 narrowing was for.
     *  `sw-register.js` registers `./service-worker.js`, so our registration's script URL is that
     *  file in this directory, and nobody else's is. Which of the three worker slots is populated
     *  depends on where in the lifecycle the registration is, so all three are consulted; a
     *  registration with none of them is not ours to remove. */
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
        // The exact script THIS app registers — `sw-register.js` calls register('./service-worker.js'),
        // so it resolves against our own directory and is ours alone.
        var ourScript = location.pathname.replace(/[^/]*$/, '') + 'service-worker.js';
        if ('serviceWorker' in navigator) {
            jobs.push(navigator.serviceWorker.getRegistrations()
                .then(function (regs) {
                    return Promise.all(regs.filter(function (r) {
                        // OURS means it is running OUR service-worker file. A scope test cannot say
                        // that: every parent scope can control this page, root included.
                        var w = r.active || r.waiting || r.installing;
                        if (!w || !w.scriptURL) return false;      // nothing to identify — leave it
                        try { return new URL(w.scriptURL).pathname === ourScript; }
                        catch (_e) { return false; }
                    }).map(function (r) { return r.unregister(); }));
                })
                .catch(function () { /* ignore */ }));
        }
        if ('caches' in window) {
            jobs.push(caches.keys()
                .then(function (keys) {
                    return Promise.all(keys.filter(function (k) {
                        // Every cache this app creates is named in service-worker.js and starts
                        // with this prefix — the versioned app cache and the SDK cache both.
                        return k.indexOf('myb-roster') === 0;
                    }).map(function (k) { return caches.delete(k); }));
                })
                .catch(function () { /* ignore */ }));
        }
        Promise.all(jobs).then(reload, reload);
    }
})();
