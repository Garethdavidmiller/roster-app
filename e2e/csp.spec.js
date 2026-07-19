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
// NOTE: this spec is intentionally NOT part of `npm run test:e2e` (playwright.config.mjs excludes it
// via `testIgnore`); it needs the hosting emulator, which `npm run test:csp` wires up.

import { test, expect } from '@playwright/test';

// Every served page (calendar at '/', the five sub-pages, the four guides). Firebase Hosting 301s
// '/index.html' -> '/', so the calendar is requested as '/'.
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
        expect(all, `CSP violations on ${path}:\n${JSON.stringify(all, null, 2)}`).toEqual([]);
    });
}
