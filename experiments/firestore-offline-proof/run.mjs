// Throwaway experiment for AUTH_PLAN.md §4 — "prove it before anyone relies on it".
//
// The claim under test: Firestore security rules are evaluated SERVER-side, so the persistent
// local cache serves reads without consulting them. Two consequences, opposite in sign:
//   · AVAILABILITY (E4): an offline member whose session has lapsed still has the roster.
//   · SECURITY: tightening the `overrides` read rule does NOT stop a browser that already
//     cached the data — which is why calendar-overrides.js carries its own gate.
//
// Both follow from the same mechanism, so one experiment settles both.
// SDK 12.16.0 is served from 127.0.0.1 — the exact bundles gstatic serves, fetched once and
// rewritten only to resolve their own cross-import locally. No CDN at run time, no proxy.
import { chromium } from '/home/user/roster-app/node_modules/@playwright/test/index.mjs';

const PROJECT = 'myb-roster-offline-proof';
const RULES_URL = `http://127.0.0.1:8080/emulator/v1/projects/${PROJECT}:securityRules`;

const ALLOW = `rules_version = '2';
service cloud.firestore {
  match /databases/{db}/documents {
    match /{document=**} { allow read, write: if true; }
  }
}`;

// The post-step-4 shape: reads require a real claim. Nothing in this harness has one.
const DENY = `rules_version = '2';
service cloud.firestore {
  match /databases/{db}/documents {
    match /overrides/{d=**} {
      allow read: if request.auth != null && (
        'name' in request.auth.token ||
        request.auth.token.admin == true ||
        request.auth.token.calendarViewer == true
      );
      allow write: if false;
    }
  }
}`;

async function setRules(content) {
    const res = await fetch(RULES_URL, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rules: { files: [{ name: 'firestore.rules', content }] } }),
    });
    if (!res.ok) throw new Error(`rules update failed: ${res.status} ${await res.text()}`);
}

const results = {};
function record(phase, key, value) {
    (results[phase] ||= {})[key] = value;
}

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
page.on('console', m => { if (m.type() === 'error') console.log('  [browser error]', m.text()); });
page.on('pageerror', e => console.log('  [pageerror]', String(e)));

try {
    // ── PHASE 1 — populate the cache while reads are permitted ──────────────────────────────────
    console.log('\n=== PHASE 1: seed + populate the persistent cache (rules ALLOW) ===');
    await setRules(ALLOW);
    await page.goto('http://127.0.0.1:8099/harness.html');
    await page.waitForFunction(() => !!window.__P, null, { timeout: 20000 });

    const seeded = await page.evaluate(() => window.__P.seed(5));
    console.log(`seeded ${seeded} override docs`);

    // A SERVER read is what fills the cache. Assert it actually came from the server, or the rest
    // of the experiment would be testing an empty cache.
    const warm = await page.evaluate(() => window.__P.readServer());
    record('allow', 'server', warm);
    if (!warm.ok || warm.count !== 5 || warm.fromCache !== false) {
        throw new Error(`cache warm-up did not read from the server: ${JSON.stringify(warm)}`);
    }
    record('allow', 'cache', await page.evaluate(() => window.__P.readCache()));

    // ── PHASE 2 — deny reads, STAY ONLINE. This is the SECURITY question ─────────────────────────
    console.log('\n=== PHASE 2: rules DENY, network UP ===');
    await setRules(DENY);
    // A fresh page: new SDK instance, same IndexedDB. This is the real-world shape — the member
    // reloads after the rules deploy, and the browser still holds what it cached yesterday.
    await page.reload();
    await page.waitForFunction(() => !!window.__P, null, { timeout: 20000 });

    const denied = await page.evaluate(() => window.__P.readServer());
    record('deny-online', 'server', denied);
    // THE CONTROL. If the server read still succeeds, the rules did not take and every "cache still
    // works" result below is meaningless — it would be measuring a permissive database. Abort.
    if (denied.ok || denied.code !== 'permission-denied') {
        throw new Error(`DENY rules are not denying — server read returned ${JSON.stringify(denied)}`);
    }
    record('deny-online', 'cache',  await page.evaluate(() => window.__P.readCache()));
    record('deny-online', 'listener', await page.evaluate(() => window.__P.listenOnce(8000)));
    // After a denied LISTEN, does the cache still hold the data? (Does a denied listen evict?)
    record('deny-online', 'cache-after-listener', await page.evaluate(() => window.__P.readCache()));

    // ── PHASE 3 — deny reads AND go offline. This is the E4 availability question ────────────────
    console.log('\n=== PHASE 3: rules DENY, Firestore network DISABLED ===');
    await page.reload();
    await page.waitForFunction(() => !!window.__P, null, { timeout: 20000 });
    await page.evaluate(() => window.__P.goOffline());

    record('deny-offline', 'cache',   await page.evaluate(() => window.__P.readCache()));
    record('deny-offline', 'default', await page.evaluate(() => window.__P.readDefault()));
    record('deny-offline', 'listener', await page.evaluate(() => window.__P.listenOnce(8000)));

    // ── PHASE 4 — reconnect with rules still denying: what does a live listener do? ──────────────
    console.log('\n=== PHASE 4: reconnect while rules still DENY ===');
    await page.evaluate(() => window.__P.goOnline());
    record('reconnect', 'watch', await page.evaluate(() => window.__P.watch(8000)));
    record('reconnect', 'cache-after', await page.evaluate(() => window.__P.readCache()));

    // ── PHASE 5 — transport-level offline, not just Firestore's own flag ─────────────────────────
    console.log('\n=== PHASE 5: rules DENY, TRANSPORT offline (context.setOffline) ===');
    await page.reload();
    await page.waitForFunction(() => !!window.__P, null, { timeout: 20000 });
    await ctx.setOffline(true);   // AFTER the load — the page must exist before the wire is cut
    record('transport-offline', 'cache', await page.evaluate(() => window.__P.readCache()));
    record('transport-offline', 'default', await page.evaluate(() => window.__P.readDefault()));
    await ctx.setOffline(false);
} finally {
    console.log('\n================ RESULTS ================');
    console.log(JSON.stringify(results, null, 2));
    await browser.close();
}
