// What does the auth boot emit when the device is OFFLINE with a stored user?
//
// The identity round-trip decision (ROADMAP.md → Calendar start) implicitly assumes that waiting
// for `accounts:lookup` always buys the server's check on the stored account. This asks the
// question that assumption skips: when the network is down and the lookup CANNOT run, does Firebase
// emit the stored user anyway (the check is only enforced when the network is up), or emit nothing
// (offline members are blocked at Recognised)?
//
// Either answer matters. "Emits anyway" means a device already trusts the stored identity whenever
// it is offline, so refusing to trust it for one paint online buys less than it appears. "Emits
// nothing" means E4's offline grace question is sharper than AUTH_PLAN states, because the member
// never reaches Recognised at all.
//
// Three arms, same page (arm-today.html — the shipped graph):
//   fresh-token + offline   : sign in, reload offline immediately
//   stale-token + offline   : sign in, wait past token expiry is impractical (1h) — instead the
//                             emulator is STOPPED, which fails the network call the same way the
//                             transport does, without touching the token. (Named honestly below.)
//   control (online)        : the measured baseline from run.mjs, re-checked here.
import { chromium } from '/home/user/roster-app/node_modules/@playwright/test/index.mjs';
import { rmSync } from 'node:fs';

const BASE = 'http://127.0.0.1:8098';
const PROFILE = '/tmp/offline-proof';

async function boot(page) {
    await page.waitForFunction(() => !!window.__P, null, { timeout: 30000 });
    return page.evaluate(() => window.__P.authBoot());
}

rmSync(PROFILE, { recursive: true, force: true });
const ctx = await chromium.launchPersistentContext(PROFILE, { headless: true });
const page = ctx.pages()[0] || await ctx.newPage();

// Session 1 — online: sign in so there is something to restore.
await page.goto(`${BASE}/arm-today.html`);
await page.waitForFunction(() => !!window.__P, null, { timeout: 30000 });
const who = await page.evaluate(() => window.__P.signIn());
if (!who) throw new Error('sign-in failed');

// Control: an ONLINE reload restores (the baseline).
await page.reload();
const online = await boot(page);

// Arm 1 — the auth ENDPOINT unreachable, page still served. This is the shape a train tunnel
// gives an installed PWA: the SW serves the app, the network call fails. Playwright's route
// abort makes exactly that cut.
await page.route('**://127.0.0.1:9098/**', route => route.abort('internetdisconnected'));
await page.reload();
const offlineEndpoint = await boot(page);
await page.unroute('**://127.0.0.1:9098/**');

// Arm 2 — full offline via context.setOffline (DNS-level), SW-less so the page itself must be
// cached... http-server still serves localhost even "offline" in Playwright? setOffline blocks
// remote hosts; 127.0.0.1 behaviour varies — report what happens rather than assume.
await ctx.setOffline(true);
let offlineFull = null;
try {
    await page.reload();
    offlineFull = await boot(page);
} catch (e) {
    offlineFull = { pageLoadFailed: String(e).split('\n')[0] };
}
await ctx.setOffline(false);

console.log(JSON.stringify({ online, offlineEndpoint, offlineFull }, null, 2));
await ctx.close();
rmSync(PROFILE, { recursive: true, force: true });
