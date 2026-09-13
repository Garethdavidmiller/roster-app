// Listed in `jsconfig.json`'s `exclude`, like every other Playwright config. That list is how they
// stay out of `tsc`, and it is BY NAME — so a new config is in scope until it is added, which is
// not obvious and cost a round here: importing `e2e/dev-server.mjs` then failed the typecheck on
// `process`, in a file this change does not touch (`exclude: ["e2e"]` does not stop a module
// reached through an import). Add a new runner config to that list when you add one.
/**
 * playwright.visual-webkit.mjs — a SMALL visual baseline set under Safari's engine.
 * `npm run test:visual:webkit`.
 *
 * ── WHY ─────────────────────────────────────────────────────────────────────────────────────────
 *
 * The v23.01 external review's observation, and it is exactly right: this repo proves iOS
 * BEHAVIOUR better than it proves iOS APPEARANCE. `npm run test:webkit` runs the whole smoke suite
 * under WebKit, so engine semantics, API availability and layout ASSERTIONS are covered — while
 * every pixel baseline is Chromium. A Safari-only rendering difference, in an app whose staff are
 * half on iPhones, had nothing looking at it.
 *
 * ── SEPARATE BASELINES, NOT SHARED ONES ─────────────────────────────────────────────────────────
 *
 * These are a different engine's pixels and will never equal Chromium's — different font
 * rasterisation, different sub-pixel rounding, different form-control metrics. They live under
 * `e2e/visual-baselines/webkit/`, which is what `snapshotPathTemplate` is for. The Chromium config
 * flattens to `e2e/visual-baselines/{arg}`, so WITHOUT the extra segment every WebKit shot would
 * overwrite its Chromium twin and each lane would clobber the other on alternate runs.
 *
 * ── deviceScaleFactor 1, DELIBERATELY ───────────────────────────────────────────────────────────
 *
 * `devices['iPhone 13']` carries DPR 3, which makes every capture nine times the pixels — bigger
 * committed PNGs, slower diffs, and a stronger sub-pixel shimmer for the tolerance to absorb. What
 * this lane is for is ENGINE LAYOUT differences (a control sized differently, a flex line breaking
 * where it does not in Blink, a font metric shifting a row), and those are all visible at 1×. The
 * viewport and the engine are what matter and both are kept.
 *
 * ── AND IT GATES NOTHING ────────────────────────────────────────────────────────────────────────
 *
 * Same posture as the Chromium visual lane, for the same reason: pixels are environment-sensitive,
 * and a lane that can fail a build on a renderer difference nobody can act on gets muted. It runs
 * report-only in branch CI. The review named the cost — "CI time on every branch" — and this is the
 * cheap half of the answer: a handful of surfaces, not the whole 45.
 */

import { defineConfig, devices } from '@playwright/test';
import { devServer } from './e2e/dev-server.mjs';

// Its own port, so a run here cannot adopt — or be adopted by — the Chromium visual lane's server.
const DEV = devServer(4003);

export default defineConfig({
    testDir: './e2e',
    testMatch: 'visual-webkit.spec.js',
    timeout: 45_000,
    expect: {
        timeout: 10_000,
        toHaveScreenshot: {
            // THE SAME 0.001 AS THE CHROMIUM LANE, and the first draft of this file said otherwise.
            // It claimed 0.002 was needed because "WebKit's text rasterisation is not byte-stable",
            // asserted as measured when it had not been measured at all. It then was: six
            // consecutive runs pass (36 comparisons, zero failures), and a full `=all` regeneration
            // produced PNGs BYTE-IDENTICAL to the committed six. The noise floor here is zero, as
            // it is for Chromium — so the looser tolerance bought nothing and would have quietly
            // green-lit a visible change, which is the v18.95 defect the Chromium lane tightened
            // 0.003 → 0.001 to close.
            //
            // Measured on this container, which is where the baselines were generated. If the
            // rendering environment changes, re-measure rather than loosening: `threshold` below
            // already absorbs sub-pixel anti-aliasing, and a raised ratio is how a baseline stops
            // locking composition.
            threshold: 0.15,
            maxDiffPixelRatio: 0.001,
        },
    },
    snapshotPathTemplate: 'e2e/visual-baselines/webkit/{arg}{ext}',
    fullyParallel: false,
    workers: 1,
    reporter: [['list']],
    use: {
        baseURL: DEV.baseURL,
        ...devices['iPhone 13'],
        // See the header: 1× keeps the baselines small and the diff quiet without giving up the
        // engine or the viewport, which are the two things this lane exists for.
        deviceScaleFactor: 1,
        trace: 'retain-on-failure',
    },
    projects: [{ name: 'mobile-safari' }],
    webServer: DEV.webServer,
});
