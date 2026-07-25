// Deployed-CSP proof — the runtime counterpart to the static csp-hygiene.test.mjs.
//
// Runs ONLY under playwright.csp.mjs (via `npm run test:csp`), which serves the app from the
// Firebase Hosting emulator so firebase.json's real Content-Security-Policy header is applied and
// ENFORCED by Chromium. For each page we:
//   1. assert the CSP header is actually present (proves we're behind the emulator, not a bare server),
//   2. collect every `securitypolicyviolation` the browser fires while the page + Firebase init run,
//   3. assert there were none — i.e. the live policy refuses nothing the app legitimately loads.
//
// This catches the failure class the other suites can't: a directive that is too tight for what the
// app actually requests (the historical `connect-src` gstatic outage), or a policy typo — invisible
// to the http-server smoke suite (no headers) and to the static check (config-only).
//
// ONE class of violation is EXPECTED and ignored (see IGNORED_BLOCKS): telemetry beacons fired by
// Firebase Auth's own `apis.google.com` iframe. Blocking those is the policy working as intended —
// they are Google's analytics pings, not something the app needs — so counting them as failures
// asserted the wrong thing. And because they only fire if the auth iframe reaches that state before
// the test ends, they made this suite fail intermittently on CI while passing locally every time
// (three re-runs in one day, Jul 2026, on commits that touched no CSP-relevant code). The gate stays
// sharp for everything the app actually loads.
//
// NOTE: this spec is intentionally NOT part of `npm run test:e2e` (playwright.config.mjs excludes it
// via `testIgnore`); it needs the hosting emulator, which `npm run test:csp` wires up.

import { test, expect } from '@playwright/test';

// Every served page (calendar at '/', the five sub-pages, the four guides). Firebase Hosting 301s
// '/index.html' -> '/', so the calendar is requested as '/'.
/**
 * Blocked URIs that are EXPECTED and must not fail the run. Keep this list minimal and specific —
 * each entry is a promise that the app does not need that request.
 *
 * Both are fire-and-forget telemetry from the `apis.google.com` iframe Firebase Auth loads:
 *   · `www.google.com/images/cleardot.gif` — a 1×1 tracking pixel
 *   · `apis.google.com/js/gen_204`         — Google's logging beacon
 * Neither carries auth data or affects sign-in; `www.google.com` is deliberately absent from
 * `connect-src`, so refusing them is the intended outcome, not a policy that is too tight.
 */
const IGNORED_BLOCKS = [
    'www.google.com/images/cleardot.gif',
    'apis.google.com/js/gen_204',
];

/** True when a violation is one of the expected third-party telemetry blocks above. */
const isIgnorable = (/** @type {{ blocked: string }} */ v) =>
    IGNORED_BLOCKS.some(u => (v.blocked || '').includes(u));

const PAGES = [
    '/', '/admin.html', '/paycalc.html', '/operations.html', '/settings.html', '/links.html',
    '/guide.html', '/paycalc-guide.html', '/railcard-guide.html', '/fip.html',
];

for (const path of PAGES) {
    test(`CSP: ${path} is served with the policy and the browser refuses nothing`, async ({ page }) => {
        // Capture in-page CSP violations. Installed before any page script so no early violation is missed.
        await page.addInitScript(() => {
            /** @type {any[]} */
            (window).__cspViolations = [];
            document.addEventListener('securitypolicyviolation', e => {
                (window).__cspViolations.push({
                    directive: e.violatedDirective,
                    blocked: e.blockedURI,
                    source: `${e.sourceFile || ''}:${e.lineNumber || ''}`,
                });
            });
        });
        // Console backstop — a few violation types are logged as "Refused to …" text.
        const consoleCsp = [];
        page.on('console', m => {
            const t = m.text();
            if (/content security policy|refused to (load|connect|execute|apply|run)/i.test(t)) consoleCsp.push(t);
        });

        const resp = await page.goto(path, { waitUntil: 'domcontentloaded' });
        // Prove we are actually behind the Hosting emulator's headers, not a header-less server —
        // otherwise "no violations" would be a vacuous pass.
        const cspHeader = resp?.headers()['content-security-policy'];
        expect(cspHeader, `${path} must be served with a Content-Security-Policy header`).toBeTruthy();

        // Every page must ALSO carry the <meta> CSP — the mechanism that gives the header-less GitHub
        // Pages mirror the same policy. Its content matching the header is enforced statically by
        // csp-meta-parity.test.mjs; here we prove it's actually present on the served page.
        const metaCsp = await page.locator('meta[http-equiv="Content-Security-Policy"]').count();
        expect(metaCsp, `${path} must carry a <meta> CSP for GitHub Pages parity`).toBeGreaterThan(0);

        // Give the ES-module graph + the runtime Firebase SDK import/connect time to attempt their
        // loads under the live policy. A CSP refusal fires synchronously when the load is attempted;
        // an unreachable host merely fails the network (NOT a violation), so this stays robust
        // regardless of whether gstatic/Firestore are reachable from the runner.
        await page.waitForTimeout(3000);

        const domViolations = await page.evaluate(() => (window).__cspViolations || []);
        const all = [
            ...domViolations,
            ...consoleCsp.map(t => ({ directive: 'console', blocked: t, source: '' })),
        ];
        // Drop the expected third-party telemetry blocks (see IGNORED_BLOCKS). Everything else is a
        // genuine "the policy refuses something the app loads" failure.
        const real = all.filter(v => !isIgnorable(v));
        expect(real, `CSP violations on ${path}:\n${JSON.stringify(real, null, 2)}`).toEqual([]);
    });
}
