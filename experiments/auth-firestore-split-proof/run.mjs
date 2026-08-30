// Does taking Firestore off the auth path make a saved sign-in arrive sooner?
//
// LATENCY_PLAN Phase 3's trigger has fired twice: `page start → Recognised` is 52% over one second
// and three times its nearest rival. Phase 3 proposes splitting Firebase Auth from Firestore. This
// prices that split BEFORE doing it, which is the plan's own "prove it on ONE page" step — the
// caution attached to the verdict is that Phase 3 "may not buy the whole 52 points".
//
// Two arms, differing in ONE thing: whether the page's module graph contains Firestore.
//   A (today): app + firestore(persistentLocalCache) + auth — firebase-client.js's own body.
//   B (split): app + auth.
// Both then run `authBootstrap`: first onAuthStateChanged emission, then the persistence ladder.
// The number reported is `performance.now()` at that moment — i.e. from navigation start, which is
// exactly what the app's `authBoot` milestone measures.
//
// The SDK is served LOCALLY and the run is warm. That is deliberate and it is the CONSERVATIVE
// direction: it prices parse, execute and IndexedDB contention while excluding the CDN fetch, and
// real devices serve the SDK from the service worker's own cache, which is closer to this than to a
// cold CDN. If the split is not worth doing on these numbers, adding network would only be an
// argument for the bytes half, which nobody disputes.
import { chromium } from '/home/user/roster-app/node_modules/@playwright/test/index.mjs';
import { rmSync } from 'node:fs';

const BASE = 'http://127.0.0.1:8098';
const RUNS = Number(process.env.RUNS || 7);
const CPU  = Number(process.env.CPU || 1);       // set CPU=4 to model a mid-range Android
// Milliseconds of latency added to every AUTH request. The arms above price the LOCAL cost of the
// module graph; this prices the other candidate, and the two together are what localise the wall.
// Firebase Auth's boot is not purely a storage read: when the stored ID token has expired (they
// last an hour) `_initializeCurrentUser` refreshes it over the network BEFORE the first
// `onAuthStateChanged` emission — so a round trip sits on the critical path, in front of the
// milestone the ladder calls `Recognised`.
const NET  = Number(process.env.NET || 0);

/** One arm: sign in once, then measure N cold RELOADS restoring that session. */
async function arm(file, label) {
    const profile = `/tmp/split-proof-${label}`;
    rmSync(profile, { recursive: true, force: true });
    const ctx = await chromium.launchPersistentContext(profile, { headless: true });
    const page = ctx.pages()[0] || await ctx.newPage();

    if (CPU > 1) {
        const cdp = await ctx.newCDPSession(page);
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
    }
    if (NET > 0) {
        // Only the auth emulator's origin is delayed. The SDK files and the harness are served
        // locally at full speed, so any growth is attributable to the auth round trips alone.
        await page.route('**://127.0.0.1:9098/**', async (route) => {
            await new Promise(r => setTimeout(r, NET));
            await route.continue();
        });
    }

    const ready = async () => {
        await page.waitForFunction(() => !!window.__P, null, { timeout: 30000 });
    };

    await page.goto(`${BASE}/${file}`); await ready();
    const who = await page.evaluate(() => window.__P.signIn());
    if (!who) throw new Error(`${label}: sign-in failed`);

    const samples = [];
    for (let i = 0; i < RUNS; i++) {
        await page.reload();                       // a fresh document — the module graph re-runs
        await ready();
        const r = await page.evaluate(() => window.__P.authBoot());
        if (!r.restored) throw new Error(`${label} run ${i}: nothing was restored — not measuring a restore`);
        samples.push(r);
    }
    await ctx.close();
    rmSync(profile, { recursive: true, force: true });
    return samples;
}

const stat = (xs) => {
    const s = [...xs].sort((a, b) => a - b);
    return {
        median: +s[Math.floor(s.length / 2)].toFixed(1),
        min: +s[0].toFixed(1),
        max: +s[s.length - 1].toFixed(1),
    };
};

const a = await arm('arm-today.html', 'today');
const b = await arm('arm-split.html', 'split');

const authA = stat(a.map(x => x.authBootMs));
const authB = stat(b.map(x => x.authBootMs));
const bodyA = stat(a.map(x => x.moduleBodyStartMs));
const bodyB = stat(b.map(x => x.moduleBodyStartMs));

console.log(JSON.stringify({
    runs: RUNS, cpuThrottle: CPU, authNetworkDelayMs: NET,
    // Navigation start → the module body running. This is the GRAPH cost: fetch + parse + execute
    // of whichever SDK modules the page imported.
    graphToBodyMs:  { today: bodyA, split: bodyB },
    // Navigation start → authBootstrap resolved. This is the app's `authBoot` milestone.
    authBootMs:     { today: authA, split: authB },
    medianSavingMs: +(authA.median - authB.median).toFixed(1),
    firestoreInitMs: stat(a.map(x => x.firestoreInitMs)),
}, null, 2));
