// @ts-check
/**
 * playwright.webkit.mjs — the smoke suite under Safari's engine. `npm run test:webkit`.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────────
 *
 * The suite has always run Chromium, the deploy gate's engine. But iOS is served as fully as Android
 * (CLAUDE.md, "Mobile is primary") — the codebase carries a dozen documented Safari workarounds
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
 * Safari's own UI. Those still need a real device, and `experiments/firestore-offline-proof/` and
 * `experiments/viewer-persistence-proof/` exist because some properties can only be measured in a
 * browser that genuinely exits.
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
 * than failing the run.
 *
 * **THE ONE CASE THAT DISCRIMINATOR GETS WRONG, and it has now happened (v22.93).** Both attempts
 * run on the SAME machine inside the SAME job, so a race that is correlated with LOAD rather than
 * with luck fails twice and reads as an engine difference. A day-panel assertion slept 600ms and
 * then read a transform that `createLightbox` sets inside a `requestAnimationFrame` — and WebKit
 * throttles rAF hard on a page it is not painting, so on a loaded shard the frame simply had not
 * arrived. It failed the attempt and the retry, passed outright on the next run, and reproduced
 * nowhere locally. Read strictly by the rule above, that says "engine difference" and sends the
 * next person hunting a WebKit CSS bug that does not exist.
 *
 * So: two failures here mean *deterministic on this machine*, which is not the same as
 * deterministic. Before concluding engine, check whether the assertion waits by SLEEPING — a fixed
 * timeout against anything gated on a frame, a transition or a network reply is the shape that
 * produces this, and the fix is to poll rather than to lengthen the sleep. CI-only, because locally a first-attempt failure is something you are
 * actively looking at and a silent retry would hide it mid-diagnosis.
 *
 * The DEPLOY gate retries once on CI too (`playwright.config.mjs`, since v23.45, after the local
 * static server dropped a socket mid-run and held a release back). It was single-shot before, on the
 * reasoning that an automatic retry hands a genuinely intermittent product bug a second chance to
 * reach staff — the base config says why that trade was taken, and what would reopen it.
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
 * The FIRST alone may not be enough, and when it is not it fails in a misleading way: the download
 * succeeds, then the launch dies listing missing shared objects (gstreamer, libwoff2, libenchant,
 * libmanette…). That reads like "unsupported" rather than "one more command", which is the trap.
 * **Try the first alone before reaching for root** (v22.93): on the container of 5 Sep 2026 the
 * system libraries were already present and `install-deps` was never needed — the browser
 * downloaded and mobile-safari launched. This paragraph said flatly that one command cannot work,
 * which would have had a session without root give up on running the engine at all.
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
 * 6.9 observed. `e2e.yml` therefore shards each project (two ways each at first; then the iPhone
 * four ways and desktop two; since 12 Nov 2026 each device as two projects, the Links specs apart,
 * nine jobs — the note above LINKS_SPECS, and e2e.yml says why), and the wall clock falls with the
 * runner count rather than fighting for cores on one machine.
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
 * 143 tests (as it then was; it was split by page on 3 Nov 2026) lands in the same shard AND the
 * same worker, and that shard has a ~4-minute serial
 * critical path however many shards there are. Turning it on lets those tests spread across every
 * shard and both workers, which is the only thing that moves the floor.
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

// THE PHONE STAFF CARRY NOW, NOT THE ONE THEY CARRIED (v24.61, iOS audit D). `devices['iPhone 13']`
// is 390×844; every iPhone Pro since the 15 — the 16 Pro, the 17 Pro and the 18 Pro, which is to a
// web page the same device as the 17 Pro — is 402×874 at the same density. The user agent and DPR
// stay the descriptor's, because the ENGINE is what this lane tests and a UA string changes no
// layout. Playwright 1.63 carries a 17 Pro descriptor (1.56 had none). Swapping to it would change only
// the iOS number in the user agent (15_0 to 18_7), which the app never reads — print-guard.js says why
// it stopped — so the lane keeps the 13's descriptor under this override. KNOWN_LIMITATIONS.md, "The
// test matrix and the phones staff carry".
export const IPHONE_PRO_VIEWPORT = { width: 402, height: 874 };

// THE LINKS SPECS RUN AS PROJECTS OF THEIR OWN (12 Nov 2026). Playwright cuts a project into shards
// by test COUNT, in file order, and cannot weigh a shard by time. The Links flows are long: on the
// iPhone they are 11% of the tests and 28% of the test time (11.9 s each on average, against 3–4 s
// elsewhere), and because they sit together in that order they all fell into one shard — 21.5
// minutes of tests against the step's 25, beside siblings of 12 to 16. On the desktop, the shard
// they shared went past the 25 on a slow runner with every test passing, twice in one night. So each
// device runs as two projects, the Links specs and everything else, and e2e.yml cuts each on its own
// (the numbers are beside the job there). `npm run test:webkit -- --project=webkit
// --project=webkit-links` is the whole desktop set.
//
// Two traps, one avoided by construction and one guarded. "Everything else" is chosen by a PATTERN
// — `!(links*)` is glob for a name that does not start with "links" — and not by an ignore list of
// its own, because a project's `testIgnore` REPLACES the shared config's list instead of adding to
// it, and the CSP, visual, offline, live and signed-in specs would start running here. Chosen this
// way, the shared list is inherited and cannot be lost. And the touch helpers decide "is this a
// phone?" from the project's NAME, so the iPhone twin is `mobile-…` and listed in
// e2e/touch-projects.js, which touch-gate-parity.test.mjs requires; under any other name the 14
// touch gates in links.spec.js would quietly take the desktop branch on an iPhone.
const LINKS_SPECS = 'links*.spec.js';
const NOT_LINKS_SPECS = '!(links*).spec.js';

export default {
    ...base,
    retries: process.env.CI ? 1 : 0,
    /* ── A LONGER BUDGET PER TEST, NOT PER ASSERTION (3 Nov 2026, the Playwright 1.63 upgrade) ──────
     *
     * The base config's 30s is for a whole TEST, and the longest specs here are flows of twenty-odd
     * steps that were already close to it on this engine. On WebKit 2215 (Playwright 1.56) the iPhone
     * project took 26.1s for "links: declining an unsaved-changes switch…", 24.4s for "every
     * line-order switch OFF…" and 21.6s for Trains' "the admin sees what changes…". WebKit 2359 runs
     * those 10–50% slower (30.6, 26.1, 26.5s), and the first ran out on CI. The time goes to
     * Playwright's own wait before each click on this engine, not to the app: measured inside the
     * Trains page, a tab's handler plus the next paint takes 30–170ms on WebKit, as on Chromium.
     *
     * So a long FLOW gets room, and no STEP does: `expect` below stays at 15s, which is the
     * sensitivity the note under it protects, and Chromium (the deploy gate) keeps the base 30s. A
     * test that hangs now takes 60s to fail instead of 30; that is the whole cost. */
    timeout: 60_000,
    /* ── WHY THIS ENGINE GETS A LONGER EXPECT BUDGET (v22.36) ────────────────────────────────────
     *
     * Playwright's 5s default is a statement about how long a correct app should take to reach a
     * state. It is the wrong number HERE, and the reason is the engine and the parallelism, not any
     * feature: `fullyParallel` puts two WebKit workers on 4 vCPU, and a cold page boot under that
     * contention runs past 5s often enough to fail a handful of assertions per full run.
     *
     * MEASURED before changing it, because "make the timeout bigger" is also what you do to hide a
     * real defect. The install strip was the symptom: three different tests failed across two full
     * runs, never the same one twice — and at ONE worker the strip was up, in the right variant, on
     * six runs out of six, already visible BEFORE the event under test was dispatched. A real
     * failure does not move between tests and vanish when the machine is idle.
     *
     * Chromium keeps the base config's 10s. It is the deploy gate, it is not contended the same way,
     * and a regression that only Chromium can see should still be caught by the tighter budget.
     *
     * **15s IS THE CEILING. DO NOT RAISE IT AGAIN** (v22.38, external review — a fair point about
     * the direction rather than the number). A generous assertion budget buys quiet at the cost of
     * the thing the budget is for: at 15s a WebKit-only slowdown severe enough to matter to a
     * member on an iPhone can still sit green, and at 30s that is close to guaranteed. Each
     * widening also makes the next one easier to argue for, which is how a budget stops being a
     * measurement and becomes a habit.
     *
     * If WebKit flakes again, the lever is CONTENTION, not patience: shard further so fewer
     * workers share the runner, or drop `fullyParallel` for the specs that flake. Both cost CI
     * minutes and neither costs sensitivity. Widening this number costs sensitivity and nothing
     * else, which is exactly the wrong trade to make twice. */
    expect: { timeout: 15_000 },
    // See the sharding note above: this is what stops one 143-test file owning a whole shard.
    fullyParallel: true,
    // Each device twice: everything but the Links specs, then the Links specs alone (the note above
    // LINKS_SPECS). A project's testMatch only narrows this lane — runner-parity.test.mjs reads a
    // lane's own specs from the TOP level, so these are not mistaken for an opt-in lane's.
    projects: [
        { name: 'webkit', testMatch: NOT_LINKS_SPECS, use: { ...devices['Desktop Safari'] } },
        { name: 'webkit-links', testMatch: LINKS_SPECS, use: { ...devices['Desktop Safari'] } },
        // Mobile Safari — the iPhone shape (viewport: the note above IPHONE_PRO_VIEWPORT).
        { name: 'mobile-safari', testMatch: NOT_LINKS_SPECS, use: { ...devices['iPhone 13'], viewport: IPHONE_PRO_VIEWPORT } },
        { name: 'mobile-safari-links', testMatch: LINKS_SPECS, use: { ...devices['iPhone 13'], viewport: IPHONE_PRO_VIEWPORT } },
    ],
};
