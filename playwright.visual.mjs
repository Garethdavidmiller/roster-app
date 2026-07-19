// Playwright config for the VISUAL-REGRESSION baseline suite (e2e/visual.spec.js).
//
// Why a separate config (mirrors playwright.csp.mjs): the smoke run (playwright.config.mjs)
// asserts BEHAVIOUR and must stay fast and environment-agnostic. Pixel screenshots are
// environment-sensitive (font rasteriser, GPU), so they live here as an OPT-IN tool
// (`npm run test:visual`) and are excluded from the smoke run (testIgnore in the main config).
// The baselines committed under e2e/visual-baselines/ were generated in the dev container's
// headless Chromium; regenerate with `npm run test:visual -- --update-snapshots` if the
// rendering environment (browser/OS/font stack) changes. See CLAUDE.md → "Visual baselines".
//
// Determinism levers (in the spec): the page clock is pinned to a fixed instant so the
// calendar/pay period are stable; Firebase is stubbed (fixtures.js) so every read is empty;
// a fixed member is seeded and every one-time overlay is pre-dismissed; fonts are awaited
// before capture; animations are disabled. Together these make the pixels reproducible.

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './e2e',
    testMatch: 'visual.spec.js',
    timeout: 30_000,
    expect: {
        timeout: 10_000,
        toHaveScreenshot: {
            // threshold = per-pixel colour sensitivity (pixelmatch YIQ); 0.15 ignores sub-pixel
            // anti-aliasing shimmer. maxDiffPixelRatio = how much of the page may differ before we
            // call it a regression. 0.3% is tight enough to catch a single recoloured button / a
            // shifted card edge (a token or layout change), yet a clean deterministic re-render
            // diffs at ~0 so it doesn't flake in this environment. Regenerate baselines if the
            // rendering environment changes (see playwright.visual.mjs header).
            threshold: 0.15,
            maxDiffPixelRatio: 0.003,
            animations: 'disabled',
            caret: 'hide',
            scale: 'css',
        },
    },
    retries: 0,
    reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
    // One flat folder of baselines, named only by the screenshot arg (one project, so no
    // project/platform suffix needed) — keeps the committed set easy to eyeball in review.
    snapshotPathTemplate: 'e2e/visual-baselines/{arg}{ext}',
    use: {
        baseURL: 'http://127.0.0.1:4001',
        serviceWorkers: 'block',
        trace: 'retain-on-failure',
    },
    // Single desktop Chromium project; each test sets its own viewport (desktop or mobile
    // width) so there is exactly one baseline per screenshot call.
    projects: [
        { name: 'visual', use: { ...devices['Desktop Chrome'] } },
    ],
    webServer: {
        command: 'npx http-server . -p 4001 -a 127.0.0.1 -c-1 --silent',
        url: 'http://127.0.0.1:4001',
        reuseExistingServer: !process.env.CI,
    },
});
