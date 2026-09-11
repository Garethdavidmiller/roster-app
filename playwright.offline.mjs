// Playwright config for the OFFLINE service-worker integration test (`npm run test:offline`).
//
// The app is offline-first, and CLAUDE.md repeatedly warns that a broken SW silently masks live
// outages — yet the smoke config BLOCKS service workers (so the Firebase route stub owns the
// network), so nothing exercises the SW's real runtime promise: precache + serve-from-cache offline.
// This config ALLOWS the SW and runs one spec that loads the app, goes offline, and asserts the SW
// still serves the precached assets + the navigation shell. Opt-in / not in the smoke gate (SW
// timing is environment-sensitive), mirroring playwright.csp.mjs and playwright.visual.mjs.

import { defineConfig, devices } from '@playwright/test';
import { devServer } from './e2e/dev-server.mjs';

// One decision, shared with `baseURL` so the two cannot disagree: which port this
// CHECKOUT serves on, and therefore which running server may be reused. See
// e2e/dev-server.mjs — a fixed port let one worktree's run adopt another's server.
const DEV = devServer(4002);

export default defineConfig({
    testDir: './e2e',
    testMatch: ['offline.spec.js'],
    timeout: 60_000,
    expect: { timeout: 20_000 },
    retries: 0,
    reporter: 'list',
    use: {
        baseURL: DEV.baseURL,
        // The whole point of this suite: let the real service worker register + control the page.
        serviceWorkers: 'allow',
        trace: 'retain-on-failure',
    },
    projects: [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    ],
    webServer: DEV.webServer,
});
