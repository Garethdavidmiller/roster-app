// PHASE 6 — the claim in its real form: "a browser that unlocked yesterday still holds every
// override it saw." run.mjs reloads the PAGE, which tears down the SDK and re-reads IndexedDB —
// necessary but not sufficient, because the browser process never exits. This closes Chromium
// entirely and reopens it against the same on-disk profile, with the rules tightened in between.
import { chromium } from '/home/user/roster-app/node_modules/@playwright/test/index.mjs';
import { rmSync } from 'node:fs';

const PROJECT = 'myb-roster-offline-proof';
const RULES_URL = `http://127.0.0.1:8080/emulator/v1/projects/${PROJECT}:securityRules`;
const PROFILE = '/tmp/offline-proof-profile';
const FLUSH_MS = Number(process.env.FLUSH_MS || 0);

const ALLOW = `rules_version = '2';
service cloud.firestore {
  match /databases/{db}/documents { match /{document=**} { allow read, write: if true; } }
}`;

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
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rules: { files: [{ name: 'firestore.rules', content }] } }),
    });
    if (!res.ok) throw new Error(`rules update failed: ${res.status}`);
}

async function open() {
    const ctx = await chromium.launchPersistentContext(PROFILE, { headless: true });
    const page = ctx.pages()[0] || await ctx.newPage();
    await page.goto('http://127.0.0.1:8099/harness.html');
    await page.waitForFunction(() => !!window.__P, null, { timeout: 20000 });
    return { ctx, page };
}

rmSync(PROFILE, { recursive: true, force: true });
const results = {};

// ── Session 1: rules permit. Seed, and fill the cache with a genuine SERVER read. ────────────────
await setRules(ALLOW);
let { ctx, page } = await open();
await page.evaluate(() => window.__P.idbPut('written-in-session-1'));
await page.evaluate(() => window.__P.seed(5));
results.session1_server = await page.evaluate(() => window.__P.readServer());
// Read from cache too, and then WAIT. Firestore's IndexedDB writes are asynchronous; closing the
// browser the instant a read resolves may simply never flush them, which would look exactly like
// "the cache does not survive a restart" while being a property of this harness, not of Firestore.
results.session1_cache = await page.evaluate(() => window.__P.readCache());
results.session1_dbs = await page.evaluate(() => window.__P.listDbs());
results.session1_disk = await page.evaluate((p) => window.__P.dumpFirestoreDb(p), PROJECT);
await page.waitForTimeout(FLUSH_MS);
if (!results.session1_server.ok || results.session1_server.fromCache !== false) {
    throw new Error('session 1 did not read from the server — nothing was cached');
}
// Close the WHOLE browser, not just the page. Chromium exits; IndexedDB stays on disk.
await ctx.close();

// ── The rules deploy happens while the browser is shut. ──────────────────────────────────────────
if (!process.env.KEEP_ALLOW) await setRules(DENY);

// ── Session 2: a fresh browser process, same profile, tightened rules. ───────────────────────────
({ ctx, page } = await open());
// THE CONTROL FOR THE CONTROL: plain IndexedDB, same origin, same profile. If this comes back null
// the profile did not persist at all and nothing below is about Firestore.
results.session2_idb = await page.evaluate(() => window.__P.idbGet());
results.session2_dbs_before_sdk_init = process.env.SKIP || await page.evaluate(() => window.__P.listDbs());
results.session2_disk = await page.evaluate((p) => window.__P.dumpFirestoreDb(p), PROJECT);
await page.waitForTimeout(Number(process.env.SETTLE_MS || 0));
results.session2_server = await page.evaluate(() => window.__P.readServer());
results.session2_cache  = await page.evaluate(() => window.__P.readCache());
results.session2_default = await page.evaluate(() => window.__P.readDefault());
results.session2_docById = await page.evaluate(() => window.__P.readDocById());
results.session2_wholeCollection = await page.evaluate(() => window.__P.readWholeCollection());
// And offline, which is the E4 case: lapsed access, no network, does the roster survive?
await page.evaluate(() => window.__P.goOffline());
results.session2_offline_cache = await page.evaluate(() => window.__P.readCache());
await ctx.close();

// THE CONTROL, again: if the server read succeeded the rules never took.
if (!process.env.KEEP_ALLOW
    && (results.session2_server.ok || results.session2_server.code !== 'permission-denied')) {
    throw new Error(`rules did not take in session 2: ${JSON.stringify(results.session2_server)}`);
}

console.log(JSON.stringify(results, null, 2));
rmSync(PROFILE, { recursive: true, force: true });
