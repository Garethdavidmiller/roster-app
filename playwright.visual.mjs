// Playwright config for the VISUAL-REGRESSION baseline suite (e2e/visual.spec.js).
//
// Why a separate config (mirrors playwright.csp.mjs): the smoke run (playwright.config.mjs)
// asserts BEHAVIOUR and must stay fast and environment-agnostic. Pixel screenshots are
// environment-sensitive (font rasteriser, GPU), so they live here as an OPT-IN tool
// (`npm run test:visual`) and are excluded from the smoke run (testIgnore in the main config).
// The baselines committed under e2e/visual-baselines/ were generated in the dev container's
// headless Chromium; regenerate with `npm run test:visual -- --update-snapshots=all` if the
// rendering environment (browser/OS/font stack) changes. See CLAUDE.md → "Visual baselines".
//
// **`=all` matters.** A bare `--update-snapshots` defaults to `changed`, which rewrites a baseline
// only when the comparison FAILED. So a baseline that drifted but stayed inside the tolerance below
// could never be refreshed by the documented command — the re-baseline silently no-opped and the
// stale image stayed committed (found v18.95, three files deep). `=all` rewrites unconditionally;
// always `git diff` the result and confirm each changed region is one you meant to change.
//
// Determinism levers (in the spec): the page clock is pinned to a fixed instant so the
// calendar/pay period are stable; Firebase is stubbed (fixtures.js) so every read is empty;
// a fixed member is seeded and every one-time overlay is pre-dismissed; fonts are awaited
// before capture; animations are disabled. Together these make the pixels reproducible.

import { defineConfig, devices } from '@playwright/test';
import { devServer } from './e2e/dev-server.mjs';

// One decision, shared with `baseURL` so the two cannot disagree: which port this
// CHECKOUT serves on, and therefore which running server may be reused. See
// e2e/dev-server.mjs — a fixed port let one worktree's run adopt another's server.
const DEV = devServer(4001);

export default defineConfig({
    testDir: './e2e',
    // TWO specs, and the second locks PAPER rather than the screen. `print-visual.spec.js` renders
    // the real PDF and rasterises page 1, so it belongs to this lane's tolerances and its
    // report-only CI job rather than to the behavioural smoke run — and it must be named here,
    // because a bare 'visual.spec.js' would have left it matched by nothing and run by nobody.
    testMatch: ['visual.spec.js', 'print-visual.spec.js'],
    timeout: 30_000,
    expect: {
        timeout: 10_000,
        toHaveScreenshot: {
            // threshold = per-pixel colour sensitivity (pixelmatch YIQ); 0.15 ignores sub-pixel
            // anti-aliasing shimmer. maxDiffPixelRatio = how much of the page may differ before we
            // call it a regression.
            //
            // TIGHTENED 0.003 → 0.001 (v18.95) on evidence, not taste. At 0.3% THREE baselines had
            // silently drifted from what the app actually renders and the suite still passed: the
            // admin week label ("12 Jul – 18 Jul 2026" → "12–18 Jul 2026", 0.18% of the frame), a
            // reflowed railcard sub-heading, and a calendar change. A gate that green-lights a
            // visibly different label is not locking composition. Re-rendering twice in this
            // environment produces BYTE-IDENTICAL PNGs — the noise floor here is zero, not 0.3% —
            // so 0.1% is still ~100× headroom for the sub-pixel shimmer the threshold above already
            // absorbs. Regenerate baselines if the rendering environment changes (see the header).
            threshold: 0.15,
            maxDiffPixelRatio: 0.001,
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
        baseURL: DEV.baseURL,
        serviceWorkers: 'block',
        trace: 'retain-on-failure',
    },
    // Single desktop Chromium project; each test sets its own viewport (desktop or mobile
    // width) so there is exactly one baseline per screenshot call.
    projects: [
        { name: 'visual', use: { ...devices['Desktop Chrome'] } },
    ],
    webServer: DEV.webServer,
});
