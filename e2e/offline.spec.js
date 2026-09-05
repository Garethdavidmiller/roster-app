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
    await page.waitForFunction(async (assets) => {
        const keys = await caches.keys();
        for (const k of keys) {
            const c = await caches.open(k);
            const hits = await Promise.all(assets.map(a => c.match(a).then(Boolean)));
            if (hits.every(Boolean)) return true;
        }
        return false;
    }, READY_ASSETS, { timeout: 30_000 });

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

// ── The revalidation count, answered by a REAL worker (v22.94) ──────────────────────────────────
//
// `perf-reporter.js` asks the service worker how many background revalidations it has started, and
// records the answer as `swrCount` — the field half of the SWR hypothesis in ROADMAP.md. Every unit
// test of that path STUBS the worker, and `sw-internals.test.mjs` runs `_revalidationCount()` in a
// sandbox; neither proves the message actually crosses to a live worker and comes back.
//
// It lands here because this is the only suite with a real registered service worker — the smoke
// run blocks them. It is opt-in (`npm run test:offline`) and so is everything around it.
//
// The numbers are asserted as a RELATION, not a constant: the count must not go DOWN across a warm
// reload, and a first install must be able to report zero. Pinning "52" would be pinning the module
// count, which changes with the app.
test('the service worker reports how many revalidations it has started', async ({ page }) => {
    await page.goto('/index.html', { waitUntil: 'load' });
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 20_000 });

    const ask = () => page.evaluate(() => new Promise((resolve) => {
        const ch = new MessageChannel();
        ch.port1.onmessage = (e) => resolve(e.data);
        navigator.serviceWorker.controller.postMessage({ type: 'REVALIDATION_COUNT' }, [ch.port2]);
        setTimeout(() => resolve(null), 4000);
    }));

    const first = await ask();
    expect(first, 'a live worker must answer the message at all').not.toBe(null);
    expect(typeof first.count, 'the reply carries a numeric count').toBe('number');

    // A warm reload re-requests the module graph through the stale-while-revalidate branch, which
    // is what fills the set. Measured here at the time of writing: 0 on first install (the precache
    // warm-up writes through cache.put and never touches that branch), then ~52.
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(2500);
    const second = await ask();
    expect(second.count, 'the count is the real set, not a constant').toBeGreaterThanOrEqual(first.count);
});
