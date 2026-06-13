// Playwright smoke-test configuration.
// Browser binaries are installed via: npx playwright install --with-deps chromium
// Run locally: npx playwright test
// Run in CI: see .github/workflows/e2e.yml

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './e2e',

    // Generous timeout: Firebase SDK loads from CDN on first run.
    // Each test gets 60s — Firebase SDK can take 5–20s to load from gstatic.com in CI.
    timeout: 60_000,

    // Assertion retry timeout: how long toBeVisible/toBeAttached etc. retry before failing.
    // 30s covers the worst-case Firebase CDN cold-start on a CI runner (typically 5–15s).
    // With 30s here (vs the old 15s), tests pass on the first attempt rather than
    // failing-then-retrying — which matters because Playwright 1.51+ exits with code 1
    // for any "flaky" test (passes on retry but failed on first attempt).
    expect: { timeout: 30_000 },

    // Two retries as a safety net; with the 30s assertion timeout above, the first
    // attempt should succeed even on a cold runner.
    retries: process.env.CI ? 2 : 0,

    // Explicit reporter prevents Playwright 1.50+ from auto-adding the GitHub Actions
    // reporter when GITHUB_ACTIONS=true — that auto-reporter has its own exit-code
    // accounting that can return 1 even when all tests pass.
    reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',

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
