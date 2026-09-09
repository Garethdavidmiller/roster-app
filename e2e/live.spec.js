// THE DEPLOYMENT HEALTH CHECK, RUN RATHER THAN REMEMBERED (`npm run test:live`).
//
// CLAUDE.md has asked for this check "occasionally, and in every review" for many releases and gave
// no way to perform it — so it was done by hand, or not at all. The warning it sits under is the
// reason it matters: **the installed PWA hides live-site breakage.** A phone that already has the
// app launches from the service-worker cache even when the live site is completely broken, so
// "my phone works" is never evidence the site is up. A real outage went unnoticed exactly that way
// (Firebase stuck on the splash, the Pages mirror 404ing, every installed phone fine).
//
// It hits the REAL DEPLOYED SITE, so it is opt-in and gates nothing: it depends on the network and
// on whatever is deployed right now, which is not a property of the branch under test. Run it after
// a release, and in a review.
//
// ── TWO ORIGINS, NOT ONE ───────────────────────────────────────────────────────────────────────
// The GitHub Pages mirror is where the majority of staff still open the app, and it serves NO
// redirects and NO HTTP headers. So it is checked as a peer of the canonical URL rather than as an
// afterthought, and sub-pages are checked as well as the root — a sub-page is precisely where the
// two origins can diverge.
//
// ── WHAT IT CANNOT SEE, AND WHY THAT DEPENDS ON HOW IT RAN ─────────────────────────────────────
// Some sandboxes cannot complete a TLS handshake to the open internet from Chromium while `curl`
// gets through (an egress relay that drops the browser's larger ClientHello). Rather than be
// unrunnable there, the suite falls back to fetching each request with `curl` and fulfilling it
// into the page: Chromium still parses and executes the real deployed bytes, over the real URLs,
// with the live response headers.
//
// That fallback is WEAKER and the run says so out loud. Anything that depends on the browser's own
// socket reaching the origin is NOT covered in relayed mode — the API-key HTTP-referrer
// restriction, and a real Firebase round trip. Both are live failure modes this repo has been bitten
// by, so the mode is printed on every run and asserted to be recorded, never quietly assumed.
//
// **DO NOT TRY TO FIX A RELAYED RUN BY CONFIGURING THE PROXY.** That is the obvious next move and it
// was measured on 9 Sep 2026: launching Chromium with `proxy: { server: process.env.HTTPS_PROXY }`
// fails identically to launching it with no proxy at all — `net::ERR_CONNECTION_RESET` both ways —
// while `curl` through that same proxy succeeds, which is why the fallback works. The relay's own
// status endpoint names it: `ws_closed_mid_exchange`, tunnel closed (1006) after 6s with ~1.8 kB
// sent and 39 B received. Thirty-nine bytes is a handshake dying, not a policy denial. So in a
// sandbox that relays, DIRECT is not reachable from the repo — the referrer restriction and the
// Firebase round trip need a human with a browser, and that is the honest hand-off, not a TODO.
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const FIREBASE = 'https://myb-roster.web.app';
const PAGES    = 'https://garethdavidmiller.github.io/roster-app';

/** Root + the two deep links the checklist names. A sub-page is where the origins can diverge. */
const TARGETS = [
    { name: 'firebase · root',    url: `${FIREBASE}/` },
    { name: 'firebase · admin',   url: `${FIREBASE}/admin.html` },
    { name: 'firebase · paycalc', url: `${FIREBASE}/paycalc.html` },
    { name: 'pages · root',       url: `${PAGES}/` },
    { name: 'pages · admin',      url: `${PAGES}/admin.html` },
    { name: 'pages · paycalc',    url: `${PAGES}/paycalc.html` },
];

/**
 * Console noise that is the app working, not failing. Kept to the SAME two telemetry beacons
 * `csp.spec.js` waives, for the same reason: they are fired by Firebase Auth's own
 * `apis.google.com` iframe and refusing them is the CSP doing its job. Anything else is a finding.
 */
const IGNORED_CONSOLE = [
    'cleardot.gif',
    'gen_204',
];
const isNoise = (/** @type {string} */ text) => IGNORED_CONSOLE.some(u => text.includes(u));

/**
 * Can this browser reach the open internet on its own? Probed once; the answer sets the mode.
 *
 * **It must probe with the BROWSER's own stack, and the obvious way does not.** `page.request` is
 * Playwright's Node-side client: it honours `HTTPS_PROXY` and succeeded here while every real
 * `page.goto` was reset, so the first cut reported DIRECT and then failed all six navigations. The
 * probe has to travel the same path the thing it is predicting travels — hence a real navigation
 * to the cheapest asset on the origin.
 */
let _direct = /** @type {boolean|null} */ (null);
async function canReachDirectly(/** @type {any} */ page) {
    if (_direct !== null) return _direct;
    try {
        const r = await page.goto(`${FIREBASE}/robots.txt`, { timeout: 20_000 });
        _direct = !!r && r.status() === 200;
    } catch { _direct = false; }
    return _direct;
}

/**
 * Fetch through `curl`, which reaches the network where the browser cannot. Returns the live
 * status, headers and body so the page sees what a real visitor would.
 * @param {string} url
 */
function curlFetch(url) {
    const hdrFile = join(tmpdir(), `live-h-${Math.random().toString(36).slice(2)}.txt`);
    const body = execFileSync('curl', ['-sS', '-L', '-D', hdrFile, '--max-time', '30', url],
        { maxBuffer: 64 * 1024 * 1024 });
    const blocks = readFileSync(hdrFile, 'latin1').split(/\r?\n\r?\n/).filter(b => b.trim());
    unlinkSync(hdrFile);
    const last = blocks[blocks.length - 1].split(/\r?\n/);
    const status = parseInt(last[0].split(/\s+/)[1], 10);
    /** @type {Record<string,string>} */
    const headers = {};
    for (const line of last.slice(1)) {
        const i = line.indexOf(':');
        if (i <= 0) continue;
        const k = line.slice(0, i).trim().toLowerCase();
        // curl has already decoded and de-chunked; re-declaring these would corrupt the body.
        if (['content-encoding', 'content-length', 'transfer-encoding'].includes(k)) continue;
        headers[k] = line.slice(i + 1).trim();
    }
    return { status, headers, body };
}

for (const target of TARGETS) {
    test(`live: ${target.name}`, async ({ page }) => {
        /** @type {string[]} */
        const errs = [];
        page.on('console', m => {
            if (m.type() === 'error' && !isNoise(m.text())) errs.push(m.text().slice(0, 200));
        });
        page.on('pageerror', e => errs.push('PAGEERROR ' + String(e).slice(0, 200)));

        const direct = await canReachDirectly(page);
        if (!direct) {
            await page.route('**/*', async (route) => {
                const url = route.request().url();
                if (!/^https?:/.test(url)) return route.abort();
                try {
                    const r = curlFetch(url);
                    await route.fulfill({ status: r.status, headers: r.headers, body: r.body });
                } catch { await route.abort(); }
            });
        }

        const resp = await page.goto(target.url, { waitUntil: 'load', timeout: 90_000 });
        // The app boots asynchronously — the access decision, the SW registration and the first
        // paint all land after `load`. Waiting here is what makes "the splash came down" mean
        // anything; asserting immediately would pass on a site that then hangs.
        await page.waitForTimeout(8_000);

        const state = await page.evaluate(() => {
            const splash = document.getElementById('splash') || document.querySelector('.splash');
            const cs = splash ? getComputedStyle(splash) : null;
            return {
                // A splash that never clears is the exact shape of the outage this exists for.
                splashUp: !!splash && !splash.hidden && cs.display !== 'none' && cs.opacity !== '0',
                // Something a reader can actually use is on screen. The Calendar's front door is a
                // sign-in card for a visitor with no session (v23.19), so this deliberately does
                // NOT require the grid: reaching that needs a member session or the staff PIN.
                text: (document.body.innerText || '').replace(/\s+/g, ' ').trim(),
            };
        });

        const mode = direct ? 'DIRECT' : 'RELAYED (curl-fulfilled — referrer + Firebase NOT covered)';
        console.log(`  ${target.name}: HTTP ${resp?.status()} · mode ${mode} · `
            + `splashUp=${state.splashUp} · console errors ${errs.length}`);
        if (errs.length) console.log(`    ${JSON.stringify(errs.slice(0, 5))}`);

        expect(resp?.status(), 'the page must be served').toBe(200);
        expect(state.splashUp, 'the splash must come down — a stuck splash IS the outage').toBe(false);
        expect(state.text.length, 'the page must render something a reader can use')
            .toBeGreaterThan(40);
        expect(errs, `console errors on ${target.url}`).toEqual([]);
    });
}
