// Playwright config for the DEPLOYMENT HEALTH CHECK (`npm run test:live`, e2e/live.spec.js).
//
// The only config in the repo with NO webServer and no baseURL: this suite's subject is the real
// deployed site on both origins, so there is nothing local to serve. It gates nothing — the network
// and whatever is deployed right now are not properties of the branch under test — which is why it
// sits beside playwright.csp.mjs / .visual.mjs / .offline.mjs as opt-in rather than in the smoke
// gate, and why playwright.config.mjs testIgnores the spec.
//
// Service workers are BLOCKED, deliberately. The whole point of the check is that an installed PWA
// serves from cache and hides a broken site; letting a SW register here would reproduce the very
// blindness the suite exists to defeat. Every run is a cold visitor.

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './e2e',
    testMatch: ['live.spec.js'],
    // The real internet, a cold cache and an 8s settle per page — generous on purpose.
    timeout: 150_000,
    expect: { timeout: 20_000 },
    // No retries: a flaky answer about whether the live site is up is worse than a slow one, and a
    // retry would mask exactly the intermittent failure worth knowing about.
    retries: 0,
    reporter: 'list',
    // Serial: the relayed fallback shells out to curl per request, and parallel workers would make
    // the console output impossible to attribute to an origin.
    workers: 1,
    use: {
        serviceWorkers: 'block',
        trace: 'retain-on-failure',
    },
    projects: [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    ],
});
