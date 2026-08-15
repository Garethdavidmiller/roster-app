// @ts-check
/**
 * playwright.webkit.mjs — the smoke suite under Safari's engine. `npm run test:webkit`.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────────
 *
 * Staff are on Android and the suite has always run Chromium, which is the right primary target.
 * But iOS is explicitly SUPPORTED — the codebase carries a dozen documented Safari workarounds
 * (`transitionend` suppressed on a backgrounded tab, `localStorage` throwing in private mode, the
 * 16px focus-zoom rule, `setPointerCapture` deferred to pointermove, ITP evicting IndexedDB after
 * ~7 days) — and until v21.28 not one of them was exercised by any browser that behaves that way.
 * Every one had been reasoned about and none had been run.
 *
 * The first run paid for itself: it found `calendar-pin.spec.js`'s footer test asserting the
 * notification bell exists unconditionally, which is a Chromium assumption. `notifSupported()`
 * correctly hides the bell where Web Push does not exist, so the app was right and the test was
 * provincial. 323 of the suite's tests pass here unchanged.
 *
 * ── WHAT THIS IS NOT ────────────────────────────────────────────────────────────────────────────
 *
 * Playwright's WebKit is not Safari, and it is certainly not an iPhone. It shares the engine, so it
 * catches ENGINE differences — CSS, layout, JS semantics, API availability. It does NOT reproduce
 * iOS-specific PWA behaviour: standalone mode, ITP's eviction schedule, the home-screen install, or
 * Safari's own UI. Those still need a real device, and the two experiments under `experiments/`
 * exist because some properties can only be measured in a browser that genuinely exits.
 *
 * ── AND IT IS DELIBERATELY NOT IN THE DEPLOY GATE ───────────────────────────────────────────────
 *
 * `deploy-hosting.yml` runs the Chromium suite before shipping. Adding a second engine there would
 * double the deploy's critical path and give a WebKit-only flake the power to keep staff on a stale
 * version — which is exactly the failure that had production four releases behind on 14 Aug 2026.
 * This runs in branch CI (`e2e.yml`), where a failure is loud and blocks nothing that staff see.
 */
import base from './playwright.config.mjs';
import { devices } from '@playwright/test';

export default {
    ...base,
    projects: [
        { name: 'webkit', use: { ...devices['Desktop Safari'] } },
        // Mobile Safari — the shape most staff would actually hold, if they hold an iPhone at all.
        { name: 'mobile-safari', use: { ...devices['iPhone 13'] } },
    ],
};
