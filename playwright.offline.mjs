// Playwright config for the OFFLINE service-worker integration test (`npm run test:offline`).
//
// The app is offline-first, and CLAUDE.md repeatedly warns that a broken SW silently masks live
// outages — yet the smoke config BLOCKS service workers (so the Firebase route stub owns the
// network), so nothing exercises the SW's real runtime promise: precache + serve-from-cache offline.
// This config ALLOWS the SW and runs one spec that loads the app, goes offline, and asserts the SW
// still serves the precached assets + the navigation shell. Opt-in / not in the smoke gate (SW
// timing is environment-sensitive), mirroring playwright.csp.mjs and playwright.visual.mjs.

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './e2e',
    testMatch: ['offline.spec.js'],
    timeout: 60_000,
    expect: { timeout: 20_000 },
    retries: 0,
    reporter: 'list',
    use: {
        baseURL: 'http://127.0.0.1:4002',
        // The whole point of this suite: let the real service worker register + control the page.
        serviceWorkers: 'allow',
        trace: 'retain-on-failure',
    },
    projects: [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    ],
    webServer: {
        // Own port (4002) so it never clashes with the smoke server (4001).
        command: 'npx http-server . -p 4002 -a 127.0.0.1 -c-1 --silent',
        url: 'http://127.0.0.1:4002',
        reuseExistingServer: !process.env.CI,
    },
});
