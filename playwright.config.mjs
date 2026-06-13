// Playwright smoke-test configuration.
// Browser binaries are installed via: npx playwright install --with-deps chromium
// Run locally: npx playwright test
// Run in CI: see .github/workflows/deploy-hosting.yml

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './e2e',

    // Generous timeout: Firebase SDK loads from CDN on first run.
    // Each test gets 45s — Firebase SDK can take 5–15s to load from gstatic.com in CI.
    timeout: 45_000,

    // Assertion retry timeout: how long toBeVisible/toBeAttached etc. retry before failing.
    // Default is 5s which is too short when JS runs after CDN module loading.
    expect: { timeout: 15_000 },

    // Two retries in CI to absorb transient network hiccups loading the Firebase SDK.
    // Zero retries locally so failures surface immediately.
    retries: process.env.CI ? 2 : 0,

    // Capture a trace on first retry so CI failures are debuggable
    use: {
        baseURL: 'http://localhost:4001',
        trace: 'on-first-retry',
    },

    projects: [
        // Desktop Chromium — catches JS/module bugs at ≥768px
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } },

        // Pixel 5 (Android 375px) — primary staff device; catches mobile-only CSS/layout
        { name: 'mobile-chrome', use: { ...devices['Pixel 5'] } },
    ],

    // Start a local static file server before the tests, stop it after.
    // -c-1 disables http-server's default 1-hour cache so SW/JS changes are visible.
    // --silent suppresses the per-request log spam during test runs.
    webServer: {
        command: 'npx http-server . -p 4001 -c-1 --silent',
        url: 'http://localhost:4001',
        // Reuse an existing server when running locally to speed up iteration.
        // Always start fresh in CI so port conflicts don't produce false passes.
        reuseExistingServer: !process.env.CI,
    },
});
