// Offline-first service-worker integration test (opt-in — `npm run test:offline`, playwright.offline.mjs).
//
// The one integration test that exercises the app's core offline promise: after an online visit the
// service worker precaches the app and, when the network drops, serves it from cache instead of a
// dead page. This catches the SW-breakage class the docs most fear (a broken/empty SW that leaves a
// fresh reload blank) — which the SW-blocked smoke suite structurally cannot reach.
//
// The Firebase SDK is still stubbed (fixtures.js page.route) so the module graph loads and the SW
// registers; the SW's own precache fetches only LOCAL http-server assets, so no CDN is needed offline.
import { test } from './fixtures.js';
import { expect } from '@playwright/test';

// The assets whose OFFLINE FETCH we assert (step 4). Includes bare './' — a root navigation the
// SW maps to cached index.html at fetch time, the real observable offline-nav guarantee.
const CORE_ASSETS  = ['./', './paycalc.html', './calendar-app.js', './roster-data.js', './shared.css'];
// The readiness poll (step 2) checks Cache STORAGE by key, so it must use the key the SW actually
// stores. The SW precaches 'index.html' and maps root→index at FETCH time (service-worker.js) — it
// never stores a literal './' entry, so caches.match('./') is always false. Poll './index.html'
// instead (the real cached key); the './' offline-nav guarantee is still proven by the fetch in step 4.
const READY_ASSETS = ['./index.html', './paycalc.html', './calendar-app.js', './roster-data.js', './shared.css'];

test('service worker precaches the app and serves it offline', async ({ page, context }) => {
    // 1) Online first visit — module graph loads (gstatic stubbed), SW registers + activates.
    await page.goto('/index.html', { waitUntil: 'load' });
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 20_000 });

    // 2) Wait for the detached, batched precache warm-up to have stored the core assets. Poll the
    //    Cache Storage directly (the SW writes the __precache-complete marker only when EVERY asset
    //    cached, but the assets we assert on land well before that).
    //    POLLED FROM NODE (whole-app review, Oct 2026). This was `page.waitForFunction(async …)`, and
    //    Playwright tests that predicate's RETURN VALUE synchronously — an async function returns a
    //    Promise, which is truthy, so the wait resolved after one evaluation whatever the cache held.
    await expect.poll(() => page.evaluate(async (assets) => {
        const keys = await caches.keys();
        for (const k of keys) {
            const c = await caches.open(k);
            const hits = await Promise.all(assets.map(a => c.match(a).then(Boolean)));
            if (hits.every(Boolean)) return true;
        }
        return false;
    }, READY_ASSETS), { timeout: 30_000, message: 'the warm-up never cached the core assets' }).toBe(true);

    // 2b) And each one is a REAL 200 in Cache Storage — the offline promise itself, asserted where it
    //     lives. Step 4's fetches cannot prove it alone: `context.setOffline` cuts the PAGE's network,
    //     not the worker's (see the note below this test), so a worker that cached nothing still
    //     answered them from the dev server and the lane passed.
    const cached = await page.evaluate(async (assets) => Promise.all(assets.map(async a => {
        const r = await caches.match(a);
        return { a, status: r ? r.status : 0 };
    })), READY_ASSETS);
    for (const { a, status } of cached) expect(status, `${a} is not in the precache`).toBe(200);

    // 3) Drop the network.
    await context.setOffline(true);

    // 4) Every core asset is still served (from the SW cache) with no network — the offline-first
    //    guarantee. A failure here means the SW did not precache / does not serve offline.
    for (const asset of CORE_ASSETS) {
        const res = await page.evaluate(async (a) => {
            try { const r = await fetch(a); return { ok: r.ok, status: r.status }; }
            catch (e) { return { ok: false, error: String(e) }; }
        }, asset);
        expect(res.ok, `offline fetch ${asset} → ${JSON.stringify(res)}`).toBe(true);
    }

    // 5) A full navigation while offline still serves the cached HTML shell (not the browser's
    //    dinosaur/error page). waitUntil:'commit' so we assert the SW-served response, not a full
    //    (subresource-dependent) load.
    const nav = await page.goto('/index.html', { waitUntil: 'commit' });
    expect(nav?.status(), 'offline navigation should be served 200 from cache').toBe(200);
    expect(await page.content()).toContain('Marylebone Roster');

    // 6) An UNCACHED deep link, offline, routes to the SW's navigation fallback (still a real page,
    //    status 200 — the SW synthesises/serves a fallback rather than failing the navigation).
    const fallback = await page.goto('/never-cached-page.html', { waitUntil: 'commit' });
    expect(fallback?.status(), 'offline uncached navigation should hit the SW fallback').toBe(200);
});

// ── WHAT THIS LANE CANNOT REACH: the no-fallback document path (v24.61, iOS audit B3) ──────────
// With NOTHING cached the document branch waits for the network and synthesises its "Offline" page
// only on the network's failure (service-worker.js, `findCachedFallback` / `offlinePage`). Two
// attempts to pin that here were measured and withdrawn (24-hour review): `context.setOffline` cuts
// the PAGE'S network, not the worker's — a worker-initiated fetch still reached the dev server with
// every cache deleted — and while the network is up the worker's warm-up refills an emptied Cache
// Storage within milliseconds of the next fetch event, so "nothing cached" cannot be held long
// enough to navigate. It is pinned instead by `sw-fetch-doc.test.mjs` (v24.64), which runs the real
// worker script against stubbed caches and network; step 6 above proves the cached-fallback path in a
// real browser, which is the one every installed device actually takes.
