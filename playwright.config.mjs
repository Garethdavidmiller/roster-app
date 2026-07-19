// Playwright smoke-test configuration.
// Browser binaries are installed via: npx playwright install --with-deps chromium
// Run locally: npx playwright test
// Run in CI: see .github/workflows/e2e.yml

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './e2e',
    // Two specs are excluded from the smoke run:
    //  • csp.spec.js — the deployed-CSP proof (playwright.csp.mjs + `npm run test:csp`): needs the
    //    Firebase Hosting emulator's real CSP header, which this http-server-backed config doesn't serve.
    //  • visual.spec.js — the visual-regression baselines (playwright.visual.mjs + `npm run test:visual`):
    //    pixel diffs are environment-sensitive, so they're an opt-in tool, not a behavioural gate.
    testIgnore: ['csp.spec.js', 'visual.spec.js'],

    // The Firebase SDK is stubbed at the network layer (e2e/fixtures.js), so pages
    // load from the local http-server only — no CDN cold-start to wait on. These
    // timeouts are comfortably generous for purely-local hermetic loads.
    timeout: 30_000,
    expect: { timeout: 10_000 },

    // Zero retries: with the CDN dependency removed the tests are deterministic, so
    // a failure is a real failure (not a transient CDN hiccup) and should surface as
    // a clean exit 1. Retries previously multiplied a slow run into the "takes ages"
    // symptom and risked the flaky-test exit-code-1-on-pass behaviour of Playwright
    // 1.51+; neither applies once the suite is hermetic.
    retries: 0,

    // Explicit reporter prevents Playwright 1.50+ from auto-adding the GitHub Actions
    // reporter when GITHUB_ACTIONS=true — that auto-reporter has its own exit-code
    // accounting that can return 1 even when all tests pass.
    reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',

    use: {
        // 127.0.0.1, not "localhost": on CI runners "localhost" can resolve to IPv6
        // ::1 first, while http-server binds IPv4 only — that mismatch makes the
        // webServer readiness probe (and every page.goto) hang then fail. Pinning
        // both sides to 127.0.0.1 removes the ambiguity.
        baseURL: 'http://127.0.0.1:4001',
        // Block service workers in tests: the app's SW (network-first, skipWaiting)
        // would otherwise intercept fetches and compete with the Firebase route stub.
        // sw-register.js catches the resulting registration rejection, so blocking is
        // safe and keeps the network fully under page.route's control.
        serviceWorkers: 'block',
        // Keep a trace for any failure so CI runs are debuggable without a retry.
        trace: 'retain-on-failure',
    },

    projects: [
        // Desktop Chromium — catches JS/module bugs at ≥768px
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } },

        // Pixel 5 (Android 375px) — primary staff device; catches mobile-only CSS/layout
        { name: 'mobile-chrome', use: { ...devices['Pixel 5'] } },
    ],

    // Start a local static file server before the tests, stop it after.
    // -a 127.0.0.1 forces an IPv4 bind that matches baseURL/url above.
    // -c-1 disables http-server's default 1-hour cache so SW/JS changes are visible.
    // --silent suppresses the per-request log spam during test runs.
    webServer: {
        command: 'npx http-server . -p 4001 -a 127.0.0.1 -c-1 --silent',
        url: 'http://127.0.0.1:4001',
        // Reuse an existing server when running locally to speed up iteration.
        // Always start fresh in CI so port conflicts don't produce false passes.
        reuseExistingServer: !process.env.CI,
    },
});
