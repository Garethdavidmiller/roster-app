// Does the Calendar viewer survive a browser restart after ONE ordinary page load?
//
// The claim under test: `authReady` runs `_setMemberPersistence()` (setPersistence → indexedDB) at
// module init on EVERY page load, and the Firebase SDK's setPersistence MIGRATES the current user
// between stores — so a viewer signed in under browserSessionPersistence is moved into IndexedDB by
// the next reload, and "dies with the browser session" stops being true.
//
// Two runs, differing in ONE step:
//   control: unlock → close browser            → expect NO user on reopen (session-only held)
//   test:    unlock → RELOAD (app boot) → close → user on reopen = the migration happened
import { chromium } from '/home/user/roster-app/node_modules/@playwright/test/index.mjs';
import { rmSync } from 'node:fs';

const PROFILE = '/tmp/viewer-proof-profile';

async function open(ctxOrNull) {
    const ctx = ctxOrNull || await chromium.launchPersistentContext(PROFILE, { headless: true });
    const page = ctx.pages()[0] || await ctx.newPage();
    await page.goto('http://127.0.0.1:8099/harness.html');
    await page.waitForFunction(() => !!window.__P, null, { timeout: 15000 });
    return { ctx, page };
}

async function scenario(withReload, boot = 'appBoot') {
    rmSync(PROFILE, { recursive: true, force: true });
    const r = {};
    // Session 1 — the unlock (and, in the test arm, one ordinary page load after it).
    let { ctx, page } = await open(null);
    r.unlocked = await page.evaluate(() => window.__P.unlock());
    r.storagesAfterUnlock = await page.evaluate(() => window.__P.storages());
    if (withReload) {
        await page.reload();
        await page.waitForFunction(() => !!window.__P, null, { timeout: 15000 });
        r.reloadBoot = await page.evaluate(b => window.__P[b](), boot);
        r.storagesAfterReload = await page.evaluate(() => window.__P.storages());
    }
    await ctx.close();   // the browser CLOSES — sessionStorage dies here

    // Session 2 — a fresh browser, same profile. Passive first (what does the SDK restore on its
    // own?), then the app boot (does the boot itself resurrect anything?).
    ({ ctx, page } = await open(null));
    r.reopenPassive = await page.evaluate(() => window.__P.passiveBoot());
    r.reopenStorages = await page.evaluate(() => window.__P.storages());
    r.reopenAppBoot = await page.evaluate(b => window.__P[b](), boot);
    await ctx.close();
    return r;
}

const arm = process.env.BOOT || 'appBoot';
const control = await scenario(false, arm);
const test = await scenario(true, arm);
console.log(JSON.stringify({ boot: arm, control, test }, null, 2));
rmSync(PROFILE, { recursive: true, force: true });
