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
 *
 * ── ONE RETRY ON CI, AND WHY THAT IS NOT CHEATING HERE (v21.40) ─────────────────────────────────
 *
 * By Aug 2026 this job was red on most pushes, and the failures were measured as flake, not signal:
 * across consecutive runs on the SAME commit the failing sets had zero overlap, and the commonest
 * failure reproduced locally 1 run in 6 on unchanged code (KNOWN_LIMITATIONS → "The webkit job is
 * intermittently red"). A job that is usually red teaches everyone to stop reading it — which
 * spends the entire value of running the engine at all.
 *
 * A retry here automates the discriminating test a human was doing by hand: an ENGINE difference —
 * the thing this suite exists to catch — is deterministic and fails both attempts, so the job stays
 * red for it. A slow-runner race passes on retry and is reported as "flaky" in the summary rather
 * than failing the run. CI-only, because locally a first-attempt failure is something you are
 * actively looking at and a silent retry would hide it mid-diagnosis.
 *
 * The DEPLOY gate keeps its single-shot rule unchanged — that reasoning (an automatic retry hands a
 * genuinely intermittent product bug a second chance to reach staff) is about a gate that ships to
 * production, which this is not.
 *
 * ── RUNNING IT LOCALLY: THE BROWSER IS NOT THERE UNTIL YOU PUT IT THERE (v21.85) ────────────────
 *
 * The dev container ships CHROMIUM only (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`), and the
 * environment notes say not to run `playwright install` — which is correct advice ABOUT CHROMIUM,
 * since re-fetching a browser that is already there wastes minutes and can pull a revision the
 * pinned `@playwright/test` does not match. It is easy to read as a blanket prohibition. It is not
 * one, and reading it that way cost a session: `npm run test:webkit` was reported as impossible
 * here and a change went to CI as the first thing to see it under this engine.
 *
 * Two commands, in this order, and it works:
 *
 *     npx playwright install webkit          # the browser binary
 *     npx playwright install-deps webkit     # ~20 system libs — apt, so it needs root
 *
 * The FIRST alone is not enough and fails in a misleading way: the download succeeds, then the
 * launch dies listing missing shared objects (gstreamer, libwoff2, libenchant, libmanette…). That
 * reads like "unsupported" rather than "one more command", which is the trap.
 *
 * Measured after doing it: **719 passed, 0 failed, 13.2 minutes** for both projects on this
 * container. So it is slow enough to be worth backgrounding and fast enough that there is no
 * excuse for shipping a CSS or layout change without it. Do not add these commands to a script or
 * a hook — they are a one-off per container, and a suite that silently apt-installs is a suite
 * nobody can reason about.
 *
 * ── SHARDED IN CI, AND WHY `fullyParallel` COMES WITH IT (v22.23) ──────────────────────────────
 *
 * The engine split at v21.80 took the wall clock from both projects to one (~19 min to ~8), and
 * there it stopped: at 8m12s this was still the job every merge waited on, against siblings
 * finishing in one to seven. Measured on the desktop-WebKit run, that 8m12s is 1m18s of setup
 * (checkout, `npm ci`, the browser and its GTK/GStreamer libs) and 6m54s of tests. So the install
 * is not the problem — the test time is, and it has two causes that have to be fixed together.
 *
 * The runner has 4 vCPU and Playwright defaults `workers` to half the CPUs, so TWO. Total serial
 * work for one project is ~11.6 WebKit-minutes, which puts the 2-worker floor at ~5.8 against the
 * 6.9 observed. `e2e.yml` therefore shards each project two ways: four jobs instead of two, and
 * the wall clock falls with the runner count rather than fighting for cores on one machine.
 *
 * MORE WORKERS WOULD HAVE BEEN THE WRONG FIX. 4 workers on 4 vCPU nominally gives ~2.9 min, but
 * this is the job with the documented flake history that the `retries: 1` above exists for, and
 * CPU contention between browser workers is a flake source. Sharding buys the same time on more
 * machines instead of less headroom on one.
 *
 * `fullyParallel` is here for SHARD BALANCE, not for speed. On its own the flag is worth little:
 * measured over the full local suite, 8.9m → 8.2m, with 783 passing either way.
 *
 * THE IMBALANCE IT FIXES IS IN TIME, NOT IN TEST COUNT — check it the other way and you will
 * conclude this comment is wrong. Playwright shards by test GROUP and balances the groups by
 * COUNT, so with the flag off the counts already come out close: measured, 204/190 against the
 * 197/197 it gives on. But with it off a group is a whole FILE, so every one of `pages.spec.js`'s
 * 143 tests lands in the same shard AND the same worker, and that shard has a ~4-minute serial
 * critical path however many shards there are. Turning it on lets those tests spread across both
 * shards and both workers, which is the only thing that moves the floor.
 *
 * The 783-green run is the evidence it is safe to turn on: no spec here uses `beforeAll`,
 * `afterAll`, `describe.serial` or module-level mutable state, so nothing depends on the order
 * tests run within a file. That was checked before the flag was set, not after it passed.
 *
 * DELIBERATELY SCOPED TO THIS FILE. `playwright.config.mjs` is shared with the DEPLOY gate's
 * Chromium run and with the visual baselines; changing parallelism under either is a separate
 * decision with a separate risk, and this file already exists to hold what is true of WebKit only.
 */
import base from './playwright.config.mjs';
import { devices } from '@playwright/test';

export default {
    ...base,
    retries: process.env.CI ? 1 : 0,
    // See the sharding note above: this is what stops one 143-test file owning a whole shard.
    fullyParallel: true,
    projects: [
        { name: 'webkit', use: { ...devices['Desktop Safari'] } },
        // Mobile Safari — the shape most staff would actually hold, if they hold an iPhone at all.
        { name: 'mobile-safari', use: { ...devices['iPhone 13'] } },
    ],
};
