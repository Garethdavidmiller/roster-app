// Playwright config for the deployed-CSP proof (e2e/csp.spec.js).
//
// UNLIKE playwright.config.mjs (which serves the app from a bare http-server that applies NO
// Firebase Hosting headers), this config points at the FIREBASE HOSTING EMULATOR, which serves
// the app with firebase.json's real headers — including the Content-Security-Policy. Real Chromium
// then ENFORCES that policy, so the spec can prove the browser refuses nothing the app legitimately
// loads. csp-hygiene.test.mjs checks the CSP config statically; this proves it at runtime.
//
// The emulator is started around the run by `npm run test:csp`
// (firebase emulators:exec --only hosting '…'), so there is NO webServer block here.

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './e2e',
    testMatch: 'csp.spec.js',
    // The real Firebase SDK loads from gstatic and Firestore connects out; give it room to attempt
    // those under the live policy (a CSP refusal fires synchronously regardless, so this is a ceiling).
    timeout: 45_000,
    expect: { timeout: 10_000 },
    retries: 0,
    reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
    use: {
        // Match the hosting-emulator bind in firebase.json (127.0.0.1, not "localhost", to avoid the
        // IPv6/IPv4 split the main config documents).
        baseURL: 'http://127.0.0.1:5000',
        // Block the service worker: we want to measure the PAGE's loads under CSP, not have the SW
        // intercept them or hammer the emulator with the ~110-file precache. The SW itself is
        // same-origin (worker-src 'self'), so blocking it hides no realistic CSP failure.
        serviceWorkers: 'block',
        trace: 'retain-on-failure',
    },
    projects: [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
        { name: 'mobile-chrome', use: { ...devices['Pixel 5'] } },
    ],
});
