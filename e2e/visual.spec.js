// Visual-regression baseline suite (Section B / F-VIS). Run OPT-IN via `npm run test:visual`
// (config: playwright.visual.mjs) — excluded from the smoke run because pixel diffs are
// environment-sensitive. Locks the composition of every key surface (including the accepted
// desktop "voids") so a CSS/layout change like the Section C token sweep can't silently
// restyle a page. When an intentional visual change lands, regenerate with
// `npm run test:visual -- --update-snapshots=all` and eyeball the new PNGs in review.
//
// TWO THINGS ABOUT REGENERATING, both learned the hard way (this header said a bare
// `--update-snapshots` until v20.11, which is the wrong half of both of them):
//   · `=all` is LOAD-BEARING. A bare `--update-snapshots` only rewrites baselines whose comparison
//     FAILED, so a baseline that drifted INSIDE the tolerance can never be refreshed by it.
//   · `=all` rewrites every baseline including the ones that PASSED. So afterwards run
//     `git status e2e/visual-baselines/` and REVERT anything you cannot explain — a v19.62 run
//     intended to capture one change came back with five modified, four of them sub-tolerance
//     rendering noise that would have been committed as though reviewed. Reverting a file and
//     re-running is the check: still passes ⇒ it was noise and does not belong in the diff.
//
// Determinism: the clock is pinned so the calendar + pay period are fixed; Firebase is stubbed
// (fixtures.js) so reads are empty; a fixed member is seeded; every one-time overlay is
// pre-dismissed; fonts + layout are awaited before capture. See playwright.visual.mjs.
//
// CAPTURE STRATEGY — fixed tall viewport, NOT fullPage. A fullPage screenshot resizes the page
// to scrollHeight at capture time; when that height is sub-pixel-unstable it rounds differently
// between runs, shifting the WHOLE frame ~1px. Instead each test sizes its viewport tall enough
// to contain the page and captures the viewport: a fixed frame with no resize, reproducible.
// Content shorter than the viewport just leaves deterministic navy below (which also locks the
// desktop "voids" we care about). Bump a height here if a page grows past its frame.
//
// EXCLUDED — mobile calendar (index.html @390px): its 7-column month grid has fractional column
// widths (390/7 = 55.71px), which Chromium rasterises with run-to-run sub-pixel variation (a ~1px
// whole-grid shift → ~12% diff) that no settle-wait or threshold can stabilise — a known limit of
// pixel-exact diffing on fractional-grid layouts, verified in review (25-run stress: ~60% flake).
// A flaky baseline is worse than none, so mobile-calendar coverage stays with the geometry-based
// e2e responsive/calendar specs; the calendar's pixels are still locked at desktop width below.

import { test, expect, enableCalendarPin } from './fixtures.js';
import { seedSession, seedMember, openRosterReview, openReference} from './helpers.js';
import { ROTATING_LINES } from '../links-design.js';

// A Wednesday inside G. Miller's rendered roster window — gives a stable "Today" cell and a
// deterministic pay period without depending on the wall clock the suite runs on.
const FIXED_TIME = new Date('2026-07-15T09:00:00Z');

// Pre-dismiss every one-time overlay/notice so no lightbox floats over the captured layout.
// Keys are the real localStorage flags each surface checks (kept in sync with the app).
function dismissOneTimeOverlays(page) {
    return page.addInitScript(() => {
        const flags = {
            'myb_pc_ytd_notice_shown': '1',    // paycalc Year-to-Date notice
            'myb_pc_ns_migrated': '1',         // paycalc legacy data-ownership prompt
            'myb_notif_prompt_done': '1',      // calendar notification prompt strip
            'myb_links_welcome_seen': '1',        // links first-visit notice
        };
        for (const [k, v] of Object.entries(flags)) {
            try { localStorage.setItem(k, v); } catch { /* iOS private mode — ignore */ }
        }
    });
}

// Common deterministic setup: pin the clock, size the viewport (tall enough to contain the
// page — see CAPTURE STRATEGY above), seed a signed-in member, silence overlays.
// setFixedTime (not clock.install) pins Date/now WITHOUT freezing the timer queue — install()
// halts setTimeout, which stalls paycalc's timer-driven init (0 cards, never auth-ready).
async function prep(page, { width, height }) {
    await page.clock.setFixedTime(FIXED_TIME);
    await page.setViewportSize({ width, height });
    await seedSession(page, 'G. Miller');
    await seedMember(page, 'G. Miller');
    // The Calendar needs a restorable Firebase identity as well as a local session since v20.12 —
    // `decideAccess` requires BOTH, so a baseline seeded with only the session would capture the
    // staff-PIN card on every calendar surface instead of the roster.
    await page.addInitScript(() => { window.__E2E = Object.assign(window.__E2E || {}, { authUser: true }); });
    await dismissOneTimeOverlays(page);
}

// Wait for the app to settle DETERMINISTICALLY: the key element visible, network idle (stubbed
// reads resolved), web fonts fully loaded (no FOUT metric shift), then two animation frames so
// the final layout has painted before we capture.
async function settle(page, ready) {
    await expect(page.locator(ready).first()).toBeVisible();
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
}

test('calendar — desktop 1280', async ({ page }) => {
    await prep(page, { width: 1280, height: 900 });
    await page.goto('/index.html');
    await settle(page, '.legend, .calendar-legend, footer');
    await expect(page).toHaveScreenshot('calendar-desktop-1280.png');
});

test('paycalc — desktop 1440 (signed in)', async ({ page }) => {
    await prep(page, { width: 1440, height: 2700 });
    await page.goto('/paycalc.html');
    await settle(page, '#settingsCard, #hoursCard');
    await expect(page).toHaveScreenshot('paycalc-desktop-1440.png');
});

// THE RESULT CARD IN ITS BACK-PAY STATE — the one the plain baselines cannot see (v20.53).
//
// The paycalc baselines above DO include the result card, but only ever in its ordinary state:
// short labels, one line each. The row that broke on a real phone was the long one — "Estimated
// take-home pay (inc. back pay)" wrapping into its own £ figure — and `.sum-row` is
// `space-between`, so a missing gap is INVISIBLE until a label grows enough to touch the figure.
// That is why every existing baseline passed unchanged through both the bug and its fix.
//
// So this captures the composition that actually varies: Regular pay + the back-pay row + the
// qualifier sub-line under the take-home figure. Element-scoped rather than full-page, so it is
// about the card rather than about everything above it.
const BACK_PAY_PERIOD = '55';   // Paid 28 Aug 2026 · P24 — the payslip the 2026 award lands on

test('paycalc result card — with back pay (mobile 390)', async ({ page }) => {
    await prep(page, { width: 390, height: 1600 });
    await page.goto('/paycalc.html');
    await settle(page, '#summary');

    await page.locator('#periodSelect').selectOption(BACK_PAY_PERIOD);
    await page.waitForTimeout(600);
    await page.evaluate(() => document.getElementById('backPayHeader')?.click());
    await page.waitForTimeout(600);
    // The include tick lives in the result card's green banner, which is not scrolled into view at
    // this size; set it the way the change handler sees it rather than fighting the viewport.
    await page.evaluate(() => {
        const t = /** @type {HTMLInputElement|null} */ (document.getElementById('bpIncludeTick'));
        if (t) { t.checked = true; t.dispatchEvent(new Event('change', { bubbles: true })); }
    });
    await page.waitForTimeout(800);

    // Sentinels BEFORE the capture. Without them a regeneration that silently lost the back-pay
    // state would re-baseline the plain card as the new truth — the Usage-card lesson (v19.25), and
    // the whole point of this test is the state, not the page.
    await expect(page.locator('#summary .sum-bp')).toHaveCount(1);
    await expect(page.locator('#summary .sum-net-sub')).toHaveText('includes back pay');
    // The figure must sit on the headline, not below it: same row, and never wrapped.
    const geom = await page.evaluate(() => {
        const row = document.querySelector('#summary .sum-net');
        const lbl = row.querySelector('.lbl').getBoundingClientRect();
        const val = row.querySelector('.val').getBoundingClientRect();
        return { gap: Math.round(val.left - lbl.right), sameLine: val.top < lbl.bottom };
    });
    expect(geom.gap, 'the £ figure must never touch the label').toBeGreaterThan(4);
    expect(geom.sameLine, 'the £ figure sits beside the headline, not under the sub-line').toBe(true);

    await expect(page.locator('#summary')).toHaveScreenshot('paycalc-result-backpay-mobile-390.png');
});

test('paycalc — mobile 390 (signed in)', async ({ page }) => {
    await prep(page, { width: 390, height: 4400 });
    await page.goto('/paycalc.html');
    await settle(page, '#settingsCard, #hoursCard');
    await expect(page).toHaveScreenshot('paycalc-mobile-390.png');
});

test('admin — desktop 1280 (signed in)', async ({ page }) => {
    await prep(page, { width: 1280, height: 1200 });
    await page.goto('/admin.html');
    await settle(page, '.card');
    await expect(page).toHaveScreenshot('admin-desktop-1280.png');
});

// ADMIN ON A PHONE (v21.38, external review). Admin had a desktop baseline and no mobile one, which
// is the wrong way round for the page most likely to be used standing on a concourse: the sticky
// member context, the week navigation, the bulk pills, the time boxes and the staged
// save bar are all interactions where an innocuous CSS change makes the page awkward WITHOUT causing
// horizontal overflow — so the responsive suite, which asks about overflow, cannot see it.
test('admin — mobile 390 (signed in)', async ({ page }) => {
    await prep(page, { width: 390, height: 1400 });
    await page.goto('/admin.html');
    await settle(page, '.card');
    await expect(page).toHaveScreenshot('admin-mobile-390.png');
});

test('operations — desktop 1280 (signed in)', async ({ page }) => {
    await prep(page, { width: 1280, height: 900 });
    await page.goto('/operations.html');
    await settle(page, '#huddleUploadCard');
    await expect(page).toHaveScreenshot('operations-desktop-1280.png');
});

// TALL ENOUGH FOR ALL FOUR CARDS (v20.09). At 900px the viewport ended two cards in, so the
// Notifications and Pay Calculator Data cards were outside the capture entirely — and that is not a
// hypothetical gap: `.card-explainer` on the Pay Calculator Data card was styled by a stylesheet
// settings.html does not load, from v19.16 to v20.08, and this baseline could never have seen it.
// The page is ~1215px at 390 wide with every card open, so 1400 holds it with room for the copy to
// grow. Same reasoning as paycalc's 2700 — a baseline that stops short is a baseline that quietly
// stops testing, and the missing part looks identical to a passing one.
test('settings — mobile 390 (signed in)', async ({ page }) => {
    await prep(page, { width: 390, height: 1400 });
    await page.goto('/settings.html');
    await settle(page, '.card');
    // Sentinel: the card that used to fall outside the frame is inside it. Without this, a future
    // viewport trim silently reverts the coverage and the baseline regenerates as though correct.
    await expect(page.locator('#payDataCard')).toBeInViewport();
    await expect(page).toHaveScreenshot('settings-mobile-390.png');
});


// ── Operations Usage card ─────────────────────────────────────────────────────────────────────
// The card needs DATA to be worth baselining — the Firebase stub returns none, so without this it
// would lock the empty state and say nothing about the composition (four sections, three bar
// groups, a stacked bar, a legend).
//
// The injection is made LOUD on purpose. A silent string-replace is the wrong shape here: if the
// anchor ever stops matching (a reformat, a signature change) the rewrite no-ops, the card renders
// EMPTY, and the next person to regenerate baselines locks that in — leaving a green test that
// stopped testing anything and nothing to say so. So a missing anchor throws, and the test asserts
// the fixture actually reached the DOM before it captures.
const USAGE_FIXTURE = `
    return {
        month: '2026-07', prevMonth: '2026-06',
        pageCounts: [{page:'calendar',count:1284},{page:'paycalc',count:412},{page:'admin',count:203},
                     {page:'settings',count:96},{page:'operations',count:31},{page:'huddle',count:341},
                     {page:'circular',count:58},{page:'guide-fip',count:12}],
        prevPageCounts: [{page:'calendar',count:1100},{page:'paycalc',count:388}],
        accountsThisMonth: 31, accountsLast30: 34,
        monthsHistory: {'2026-06':29,'2026-07':31},
        origins: [{origin:'web',accounts:22,installed:17},
                  {origin:'pages',accounts:9,installed:9},
                  {origin:'other',accounts:1,installed:0}],
    };`;

/** Serve a firebase-client.js whose usage/sign-in reads return fixed data. Throws if either anchor
 *  is missing, so the fixture can never silently stop applying. @param {import('@playwright/test').Page} page */
function stubUsageReads(page) {
    return page.route('**/firebase-client.js', async route => {
        const res = await route.fetch();
        const src = await res.text();
        const anchors = ['export async function getUsageStats() {', 'export async function getSignInStats() {'];
        for (const a of anchors) {
            if (!src.includes(a)) throw new Error(`visual: usage fixture anchor no longer matches — "${a}". `
                + 'Update it, or this baseline silently degrades to the empty state.');
        }
        const body = src
            .replace(anchors[0], anchors[0] + USAGE_FIXTURE)
            .replace(anchors[1], anchors[1]
                + ' return { last30: 28, last7: 19, last90: 33, total: 41, neverSignedIn: 5 };');
        await route.fulfill({ response: res, body, contentType: 'text/javascript' });
    });
}

test('operations — Usage card, populated (desktop 1280)', async ({ page }) => {
    await stubUsageReads(page);
    await prep(page, { width: 1280, height: 1400 });
    await page.goto('/operations.html');
    await settle(page, '#usageCard');
    await page.evaluate(() => {
        const b = document.getElementById('usageBody');
        if (b && !b.classList.contains('open')) document.getElementById('usageToggleHeader')?.click();
    });
    const card = page.locator('#usageCard');
    // Proof the fixture landed AND the card rendered from it — without these the capture below
    // could quietly be of the empty state. Deliberately NOT a label string: the first version
    // watched for "myb-roster.web.app" and broke the moment v19.26 shortened that label to
    // "web.app" for column alignment. A sentinel should prove the DATA arrived, not police the
    // copy — so: a distinctive fixture NUMBER, plus the row COUNT, both of which survive rewording.
    await expect(card).toContainText('1,284');
    await expect(card.locator('.usage-origins .usage-bar-row')).toHaveCount(3);
    await page.waitForTimeout(400);          // collapse transition + bar widths settle
    await expect(card).toHaveScreenshot('operations-usage-card.png');
});

// ── Operations App Speed card ─────────────────────────────────────────────────────────────────
// The card had NO pixel coverage until v21.29 — the release that gave it a fourth block. It is the
// densest read-only surface in the app after the roster review: two journeys, a stacked legend, a
// per-page table with two bars each, and now three stacked breakdown blocks under "Why some are
// slower". Composition that layered is exactly what drifts without anyone noticing, and the empty
// state (which is all a plain load produces) says nothing about any of it.
//
// The fixture is deliberately UNEVEN — a fast Calendar, a slow paycalc, a thin page, and a start
// ladder whose big jump is between "Unlocked" and "Shifts up". A uniform fixture would make every
// bar the same width and lock in a picture that could not show a layout fault.
function perfSamples() {
    const out = {};
    const add = (page, metric, bucket, n, conn = '4g', mode = 'standalone', ver = 'v21.29') => {
        out[[ver, page, metric, bucket, mode, conn].join('|')] = n;
    };
    for (const [m, quick, ok, slow] of [['fcp', 900, 180, 40], ['domReady', 700, 300, 120], ['ready', 520, 260, 180]]) {
        add('calendar', m, 'lt500ms', quick); add('calendar', m, '1-3s', ok); add('calendar', m, '3-8s', slow);
        add('paycalc',  m, 'lt500ms', 120);   add('paycalc',  m, '1-3s', 210); add('paycalc', m, '3-8s', 95);
        add('settings', m, 'lt500ms', 4);     // thin — must wear the "(few)" marker, not a confident bar
    }
    add('login', 'loginTotal', 'lt500ms', 40); add('login', 'loginTotal', '1-3s', 22); add('login', 'loginTotal', '3-8s', 9);
    // Boot stages — contiguous spans, finer bands.
    add('calendar', 'swBoot',  'lt500ms', 900); add('calendar', 'swBoot',  '500ms-1s', 60);
    add('calendar', 'sdkLoad', 'lt500ms', 700); add('calendar', 'sdkLoad', '500ms-1s', 220); add('calendar', 'sdkLoad', '1-3s', 40);
    add('calendar', 'appBoot', 'lt500ms', 820); add('calendar', 'appBoot', '500ms-1s', 120);
    // The start ladder — the point of the fixture. Signed in and Unlocked are quick; the roster is
    // where the time goes, which is the shape the block exists to make visible at a glance.
    add('calendar', 'authBoot',   'lt500ms', 940); add('calendar', 'authBoot',   '1-3s', 30);
    add('calendar', 'access',     'lt500ms', 900); add('calendar', 'access',     '1-3s', 70);
    add('calendar', 'rosterLive', 'lt500ms', 300); add('calendar', 'rosterLive', '1-3s', 420); add('calendar', 'rosterLive', '3-8s', 240);
    // Second connection class, so the "Why some are slower" splits have something to split.
    add('calendar', 'domReady', '1-3s', 160, '3g'); add('calendar', 'domReady', '3-8s', 90, '3g');
    add('calendar', 'domReady', '1-3s', 60, '4g', 'browser');
    return out;
}

/** Serve a firebase-client.js whose perf read returns the fixture. Loud on a missing anchor, for
 *  the same reason as the Usage stub: a silent no-op would baseline the EMPTY card.
 *  @param {import('@playwright/test').Page} page */
function stubPerfReads(page) {
    return page.route('**/firebase-client.js', async route => {
        const res = await route.fetch();
        const src = await res.text();
        const anchor = 'export async function getPerfStats() {';
        if (!src.includes(anchor)) throw new Error(`visual: perf fixture anchor no longer matches — "${anchor}". `
            + 'Update it, or this baseline silently degrades to the empty state.');
        const fixture = `
    {
        const _s = ${JSON.stringify(perfSamples())};
        const _w = (month) => ({ month,
            login: summarisePerf(_s, { metric: 'loginTotal' }),
            fcp:   summarisePerf(_s, { metric: 'fcp' }),
            pages: summarisePerf(_s, { metric: 'domReady' }),
            ready: summarisePerf(_s, { metric: 'ready' }),
            samples: _s });
        return { thisMonth: _w('2026-08'), lastMonth: _w('2026-07') };
    }`;
        await route.fulfill({ response: res, body: src.replace(anchor, anchor + fixture), contentType: 'text/javascript' });
    });
}

test('operations — App Speed card, populated (desktop 1280)', async ({ page }) => {
    await stubPerfReads(page);
    await prep(page, { width: 1280, height: 1800 });
    await page.goto('/operations.html');
    await settle(page, '#pageSpeedCard');
    await page.evaluate(() => {
        const b = document.getElementById('pageSpeedBody');
        if (b && !b.classList.contains('open')) document.getElementById('pageSpeedToggleHeader')?.click();
    });
    const card = page.locator('#pageSpeedCard');
    // Same sentinel discipline as the Usage card: prove the DATA arrived and the new block rendered,
    // rather than policing copy. Four ladder rows is the claim — a partly-wired ladder would show
    // fewer and the capture would lock that in.
    await expect(card).toContainText('How far the start gets');
    await page.waitForTimeout(400);
    await expect(card).toHaveScreenshot('operations-speed-card.png');
});

// ── Operations roster review table ────────────────────────────────────────────────────────────
// The most state-dense surface in the app, and the LAST one with no pixel coverage — because it
// only exists after a successful PDF parse, so no plain page load can reach it. That gap is not
// theoretical: THREE UI defects in this table reached the owner rather than a screenshot diff
// (v19.32–33 — a Skip button wearing the success green while meaning "write nothing", the same
// button stretching full-width when the group wrapped, and a prose line duplicating the buttons
// beneath it). All three were found by hand-rendering it. This makes that permanent.
//
// One capture, every row state the table can produce:
//   Sun/Mon/Sat — DIFF (ticked, will save)      Wed — flagged, GARBLED (no readings → skip-only)
//   Tue — CONFLICT (a seeded manual override)   Thu — flagged with two readings, UNRESOLVED
//                                               Fri — flagged with two readings, RESOLVED
// Thu and Fri are deliberately days G. Miller WORKS: on a base rest day both readings normalise to
// RD and the picker is (correctly) not offered, so a rest day would capture the wrong thing.
test('operations — roster review table, every row state (mobile 390)', async ({ page }) => {
    await prep(page, { width: 390, height: 1500 });
    const { wasParseCalled } = await openRosterReview(page);

    // Resolve the Friday row, so the capture holds a RESOLVED pick beside an unresolved one — the
    // chosen/unchosen button treatment is exactly what was wrong twice.
    await page.locator('.roster-change-row .roster-choice-btn[data-opt="0"]').last().click();

    // SENTINELS — without these the capture could silently be of a table that rendered but lost the
    // feature. The stub reaching the app is not enough: if `choices` ever stops arriving, the rows
    // still render (as plain skip-only) and the next re-baseline would lock in a green test that had
    // quietly stopped covering the picker at all — the failure mode the Usage-card fixture documents.
    expect(wasParseCalled(), 'the parse stub never fired — the function URL probably changed').toBe(true);
    await expect(page.locator('.roster-change-row')).toHaveCount(7);
    await expect(page.locator('.roster-pick')).toHaveCount(3);          // 1 conflict + 2 flagged
    await expect(page.locator('.roster-choice-btn[data-opt="0"].is-chosen')).toHaveCount(1);

    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);          // let the button background transition settle

    // A COLOUR contract this baseline provably cannot hold, so it is asserted directly. Deleting the
    // neutral-Skip rule (the v19.32 defect: Skip wearing the "this will be saved" green while meaning
    // write nothing) does NOT fail the screenshot — verified, not assumed. `--text-mid` sits at L45%
    // and `--success-green` at L48.5%, and pixelmatch's per-pixel delta is luminance-dominated, so a
    // hue-only swap at near-equal lightness falls under the 0.15 threshold that exists to absorb
    // anti-aliasing shimmer. Lowering that threshold to catch one rule would trade a real flake risk
    // across all 16 baselines; reading the computed colour costs nothing and says what is meant.
    // The lesson generalises: a visual baseline covers LAYOUT, not semantics.
    //
    // MUST run after the wait above. Read mid-transition (`transition: background var(--dur-med)`),
    // the two settle to the SAME green but serialise differently — `oklch(...)` vs an interpolated
    // `oklab(...)` — so a string compare called them different and the assertion passed with the rule
    // deleted. A false pass, found only by printing both values.
    const [skipBg, valueBg] = await page.evaluate(() => [
        getComputedStyle(/** @type {Element} */ (document.querySelector('.roster-choice-btn--skip.is-chosen'))).backgroundColor,
        getComputedStyle(/** @type {Element} */ (document.querySelector('.roster-choice-btn[data-opt="0"].is-chosen'))).backgroundColor,
    ]);
    expect(skipBg, 'Skip must not wear the colour that means "this will be saved"').not.toBe(valueBg);

    await expect(page.locator('#rosterReviewSection')).toHaveScreenshot('operations-roster-review.png');
});

// ── Links workspace ───────────────────────────────────────────────────────────────────────────
// The app's most visually complex surface — a 28×7 grid, an hour-by-hour heat map, a paint bar, a
// design picker — and until v19.38 it had no pixel coverage at all. Baselined at DESKTOP, where the
// grid's sticky header and the ≥1024px `overflow-x` drop are load-bearing (see the links rules doc);
// the mobile view is the same grid with horizontal scroll.
//
// A generated design is used rather than the empty state: an all-rest grid locks almost nothing,
// and the heat map — the artefact a coverage gap is spotted on — renders nothing without shifts.
const LINKS_DESIGN = (() => {
    /** @type {Record<string, any>} */
    const patterns = {};
    const shifts = ['06:20-14:20', '07:00-15:00', '11:00-19:30', '14:00-22:30', 'SPARE', 'RD', 'RD'];
    // ROTATING_LINES. A fixture LONGER than the rotation would trip the over-length notice and
    // silently re-baseline the legacy-design surface as though it were the normal one.
    for (let i = 1; i <= ROTATING_LINES; i++) {
        /** @type {Record<string, string>} */
        const row = {};
        ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].forEach((d, j) => {
            row[d] = (i % 4 === 0 && (j === 0 || j === 6)) ? 'RD' : shifts[(i + j) % shifts.length];
        });
        patterns[String(i)] = row;
    }
    return patterns;
})();

// THE BLANK PAGE HAD NO PIXEL COVERAGE AT ALL, WHICH IS HOW IT DRIFTED (v19.66). Every other links
// baseline seeds a design, so the state a new designer actually meets first was the one surface
// nothing ever looked at — and it had become three white slabs (160/117/117px) each holding one
// grey sentence pinned to the left edge, with the grid card's header still describing a paint bar
// that was not on screen. All 256 e2e tests passed throughout: they assert text and behaviour.
//
// This is a whole-page shot rather than one card, deliberately — the defect was the RELATIONSHIP
// between the three cards (three empty boxes in a column), which no single-card capture can see.
test('links — the blank state, no designs saved (desktop 1280)', async ({ page }) => {
    await page.addInitScript(() => {
        /** @type {any} */ (window).__E2E = /** @type {any} */ (window).__E2E || {};
        /** @type {any} */ (window).__E2E.docs = [];
    });
    await prep(page, { width: 1280, height: 900 });
    await page.goto('/links.html');
    // Sentinels: the empty state must be the thing on screen, and it must carry its action — a
    // regression that dropped the button would otherwise just re-baseline as the new truth.
    await expect(page.locator('#linksEmptyState')).toBeVisible();
    await expect(page.locator('#linksEmptyGenerate')).toBeVisible();
    await expect(page.locator('#linksGridHint')).not.toContainText('Paint bar');
    await settle(page, '#linksEmptyState');
    await expect(page.locator('#linksGridCard')).toHaveScreenshot('links-blank-grid-card.png');
});

test('links — design grid + coverage + checks (desktop 1280)', async ({ page }) => {
    await page.addInitScript((pats) => {
        /** @type {any} */ (window).__E2E = /** @type {any} */ (window).__E2E || {};
        /** @type {any} */ (window).__E2E.docs = [{
            id: 'd1', name: 'Option A', updatedBy: 'S. Silva', patterns: pats,
        }];
    }, LINKS_DESIGN);
    await prep(page, { width: 1280, height: 2400 });
    await page.goto('/links.html');

    // Sentinels BEFORE the capture. Without them a regression that dropped the seeded design still
    // renders a plausible page — a grid of empty rows and an empty-state heat map — and the next
    // baseline regeneration would lock in a green test covering nothing (the Usage-card lesson,
    // v19.25). The over-length notice is asserted ABSENT for the same reason: it is a visible band
    // above the grid, so a fixture that outgrew the rotation would change the composition and the
    // regeneration would accept it.
    await expect(page.locator('#linksGridBodyRows tr')).toHaveCount(ROTATING_LINES);
    await expect(page.locator('#linksOverLengthNotice')).toBeHidden();
    await expect(page.locator('tr.row-unfilled')).toHaveCount(0, { timeout: 10000 });
    await expect(page.locator('#coverageHeatmap')).toBeVisible();
    await settle(page, '.links-grid');
    await expect(page).toHaveScreenshot('links-workspace.png');
});

// The AUTO-GENERATOR had no pixel coverage at all until v19.64, because the card is collapsed in the
// workspace baseline above — so four consecutive releases reshaped it with nothing but hand-read
// screenshots watching. That is a lot of surface: the target table, the spare-week row, the
// totals, and the five line-order objectives, all of which moved between v19.58 and v19.63.
//
// It is also where this page's layout bugs actually happen. The list is not hypothetical: an inline
// number box that dropped into the checkbox column under `display: grid`; a spare-row caption that
// overflowed its own sticky cell; two adjacent checked rows sharing an edge and reading as one tall
// box; a 90px shift time floating in a 477px cell. Every one of those passed the behavioural suite,
// because behaviour tests assert text and these are all composition.
test('links — auto-generator card, objectives on and off (desktop 1280)', async ({ page }) => {
    await page.addInitScript((pats) => {
        /** @type {any} */ (window).__E2E = /** @type {any} */ (window).__E2E || {};
        /** @type {any} */ (window).__E2E.docs = [{
            id: 'd1', name: 'Option A', updatedBy: 'S. Silva', patterns: pats,
        }];
    }, LINKS_DESIGN);
    await prep(page, { width: 1280, height: 2600 });
    await page.goto('/links.html');
    await expect(page.locator('#linksGridBodyRows tr')).toHaveCount(ROTATING_LINES);
    await page.evaluate(() => document.getElementById('generatorBody')?.classList.add('open'));

    // TWO objectives are switched off deliberately: the whole point of the v19.63 restyle is that on
    // and off look different, and a baseline showing five identical rows could not tell whether the
    // checked treatment still existed.
    await page.locator('#objWeekends').uncheck();
    await page.locator('#objTurnarounds').uncheck();

    // Sentinels before the capture — same reasoning as the workspace shot. The target table is
    // SEEDED FROM THE ROSTER, so a regression in `buildRosterTargets` would render a plausible but
    // empty generator, and the next baseline regeneration would lock in a green test covering
    // nothing. FOUR is the seeded figure — main 1/7/12/17, with the seed adding nothing to it. It
    // was 6 while the bilingual roster was in scope (its 1 and 8) and briefly 5 at v20.01, and this
    // sentinel has caught every one of those changes on the regeneration run, which is exactly what
    // it is for: without it the new figure is baselined as a picture and nobody looks at the number.
    // The objective COUNT is asserted for the same reason — the run cap made it six at v20.02.
    await expect(page.locator('#genSlotRows tr').first()).toBeVisible();
    await expect(page.locator('#genSpareLines')).toHaveValue('4');
    await expect(page.locator('.gen-obj')).toHaveCount(6);
    await expect(page.locator('.gen-obj:has(input:checked)')).toHaveCount(4);   // 6 total, 2 unchecked above

    // THE CHECKED TREATMENT IS ASSERTED IN COMPUTED STYLE, NOT LEFT TO THE PIXELS — and that split
    // is deliberate, because the pixels genuinely cannot see it. `--bg-faint` is oklch(97%) against
    // white: a 3% lightness step, far under this config's `threshold: 0.15` per-pixel sensitivity,
    // so pixelmatch scores those pixels identical. Teeth-verified — deleting the fill AND the shadow
    // from `.gen-obj:has(input:checked)` left the screenshot passing.
    //
    // So the two do different jobs here and both are needed: the baseline below catches COMPOSITION
    // (removing the 8px row gap fails it, as it should), and this catches the on/off STATE, which is
    // the whole point of the v19.63 restyle.
    // ASSERTING THE FILLS MERELY DIFFER WAS NOT ENOUGH, AND v19.65 is the proof (staff report:
    // "everything doesn't quite look right"). They differed the WRONG WAY ROUND: checked
    // `--bg-faint`, unchecked `white`, so switching an objective ON made its row 3% dimmer, and
    // against this panel's `--surface-sunken` (L 96.3%) the checked fill landed 0.7% away — visually
    // nothing. With all five on, the default, every row was panel-coloured inside a navy outline.
    // Both assertions below passed throughout. So the DIRECTION is what has to be pinned, measured
    // against the SUBSTRATE the rows sit on, not just against each other.
    //
    // Resolved through a canvas so `oklch()`, `oklab()` and `rgb()` are all compared as sRGB —
    // getComputedStyle hands back whichever notation the author used, and these three surfaces are
    // declared in two different ones.
    const rowStyles = await page.evaluate(() => {
        const lum = (/** @type {string} */ c) => {
            const cv = document.createElement('canvas');
            cv.width = cv.height = 1;
            const ctx = /** @type {CanvasRenderingContext2D} */ (cv.getContext('2d'));
            ctx.fillStyle = c;
            ctx.fillRect(0, 0, 1, 1);
            const d = ctx.getImageData(0, 0, 1, 1).data;
            return (d[0] + d[1] + d[2]) / 3;
        };
        const cs = (/** @type {string} */ sel) => {
            const el = document.querySelector(sel);
            if (!el) return null;
            const s = getComputedStyle(el);
            return { bg: s.backgroundColor, lum: lum(s.backgroundColor), border: s.borderTopColor, shadow: s.boxShadow };
        };
        const panel = getComputedStyle(/** @type {Element} */ (document.querySelector('.gen-objectives'))).backgroundColor;
        return {
            on: cs('.gen-obj:has(input:checked)'),
            off: cs('.gen-obj:not(:has(input:checked))'),
            panelLum: lum(panel),
        };
    });
    expect(rowStyles.on, 'a checked objective row must exist').not.toBeNull();
    expect(rowStyles.off, 'an unchecked objective row must exist').not.toBeNull();
    expect(rowStyles.on.bg, 'checked and unchecked rows must not share a fill').not.toBe(rowStyles.off.bg);
    expect(rowStyles.on.border, 'checked and unchecked rows must not share a border').not.toBe(rowStyles.off.border);
    expect(rowStyles.on.shadow, 'the checked row carries the lift').not.toBe('none');
    // ON brightens, OFF recedes — the app's three-surface cue (css-tokens.md), the direction v19.63
    // had backwards.
    expect(rowStyles.on.lum, 'a checked row must be BRIGHTER than an unchecked one, not dimmer')
        .toBeGreaterThan(rowStyles.off.lum);
    // And it has to clear the panel by enough to be seen. 0.7% of L was the shipped value; 2% of
    // 255 is ~5, comfortably under the real gap (white over `--bg-faint`) and comfortably over the
    // gap that produced the bug.
    expect(rowStyles.on.lum - rowStyles.panelLum, 'the checked fill must be visible against the panel it sits on')
        .toBeGreaterThan(5);

    await settle(page, '.gen-objectives');
    await expect(page.locator('#generatorCard')).toHaveScreenshot('links-generator.png');
});

// The same card at a NARROW viewport, where its layout rules actually differ: the shift-time column
// goes sticky, the objectives stack, and the numeric clause is squeezed to the width where it broke.
//
// NOTE WHAT THIS DOES NOT COVER. `playwright.visual.mjs` runs ONE desktop project, so this is a
// narrow window on a FINE pointer — the `@media (pointer: coarse)` rules (16px fields, the 20px
// checkbox, the 44px targets) are NOT exercised here and must not be assumed to be. Those are
// measured instead, by the focus-zoom gate in pages.spec.js which runs on a real coarse pointer.
test('links — auto-generator card at a narrow width (390)', async ({ page }) => {
    await page.addInitScript((pats) => {
        /** @type {any} */ (window).__E2E = /** @type {any} */ (window).__E2E || {};
        /** @type {any} */ (window).__E2E.docs = [{
            id: 'd1', name: 'Option A', updatedBy: 'S. Silva', patterns: pats,
        }];
    }, LINKS_DESIGN);
    await prep(page, { width: 390, height: 1400 });
    await page.goto('/links.html');
    await expect(page.locator('#linksGridBodyRows tr')).toHaveCount(ROTATING_LINES);
    await page.evaluate(() => document.getElementById('generatorBody')?.classList.add('open'));
    await page.locator('#objWeekends').uncheck();

    await expect(page.locator('.gen-obj')).toHaveCount(6);   // the run cap joined at v20.02
    await expect(page.locator('.gen-obj:has(input:checked)')).toHaveCount(5);

    // The numeric clause's one-line contract is NOT asserted here, and the reason is the note above:
    // this project is fine-pointer, where the number box is 52×28 and the clause fits whatever you
    // do to it. The v19.65 fragmentation only happens at 56×40 — the coarse-pointer size. Measured:
    // deleting the `white-space: nowrap` that fixes it leaves this test green. It lives in
    // pages.spec.js on mobile-chrome instead, where it fails.
    await settle(page, '.gen-objectives');
    await expect(page.locator('.gen-objectives')).toHaveScreenshot('links-objectives-narrow.png');
});

// THE DESIGN CHECKS CARD HAD NO PIXEL COVERAGE EITHER, and it is the panel that goes to the
// assessing manager (v20.00). The workspace baseline above is a 2400px-tall viewport shot and this
// card starts below it, so the app's most COMPOSED surface — 30 rows, three section heads with
// right-aligned counts, a fixed-width code column, family sub-headings, a disclosure — was watched
// by nothing but text assertions. Two v20.00 layout changes landed in it (the code column moved from
// `min-width: 44px` to a fixed 52px so titles align, and the disclosure body gained a left rule so
// the second run of family headings reads as nested) and the existing suite did not move a pixel.
//
// The fixture puts the longest run in the 8–13 band deliberately: that is where the SAME figure
// renders amber against the design target and green against the company limit, which is the
// composition most at risk of reading as a contradiction.
const CHECKS_DESIGN = (() => {
    /** @type {Record<string, any>} */ const p = {};
    const W = '06:00-14:00';
    for (let i = 1; i <= ROTATING_LINES; i++) p[String(i)] = { sun: 'RD', mon: W, tue: W, wed: 'RD', thu: 'RD', fri: 'RD', sat: 'RD' };
    p['1'] = { sun: 'RD', mon: W, tue: W, wed: W, thu: W, fri: W, sat: W };
    p['2'] = { sun: W, mon: W, tue: W, wed: 'RD', thu: 'RD', fri: 'RD', sat: 'RD' };
    return p;
})();

// ⚠️ THIS BASELINE DRIFTS WITHOUT THE CONTENT CHANGING, and has now done so twice (v21.07, v21.09).
// Before assuming a regression, check the CONTENT: at 1068×1898 it is by far the largest and most
// text-dense baseline in the suite, and what shows up is a handful of narrow bands where identical
// glyphs sit a pixel across — same wrapping, same words, same panel height. At v21.09 it was chased
// properly: the differing bands were mapped (four of them, 7–14 rows each, inside one block), the
// rendered text compared word for word against the expected, and `#checksContent` measured at the
// same 1068px with and without the change in place. Nothing had moved. If it fails again, read the
// actual PNG against the expected one before re-baselining — and only re-baseline once you can say
// what, if anything, is different.
test('links — design checks panel, disclosure open (desktop 1280)', async ({ page }) => {
    await page.addInitScript((pats) => {
        /** @type {any} */ (window).__E2E = /** @type {any} */ (window).__E2E || {};
        /** @type {any} */ (window).__E2E.docs = [{
            id: 'd1', name: 'Option A', updatedBy: 'S. Silva', patterns: pats,
        }];
    }, CHECKS_DESIGN);
    await prep(page, { width: 1280, height: 900 });
    await page.goto('/links.html');
    await expect(page.locator('#linksGridBodyRows tr')).toHaveCount(ROTATING_LINES);
    await page.evaluate(() => document.querySelectorAll('#checksContent details').forEach((d) => {
        /** @type {HTMLDetailsElement} */ (d).open = true;
    }));

    // Sentinels: without them a render that lost the fatigue half still produces a plausible short
    // card, and the next regeneration would lock that in (the Usage-card lesson, v19.25).
    await expect(page.locator('#checksContent .check-code').first()).toBeVisible();
    await expect(page.locator('#checksContent')).toContainText('Longest run');
    await expect(page.locator('#checksContent')).toContainText('design target');
    await expect(page.locator('#checksContent')).toContainText('consecutive days worked');
    await settle(page, '#checksContent');
    await expect(page.locator('#checksContent')).toHaveScreenshot('links-design-checks.png');
});

// The "Recently deleted" panel (v19.41) had NO pixel coverage, and it shipped broken because of it:
// it used the bare `.lb-content`, which is only the transform/scroll base, so it rendered as a
// transparent box — heading and prose in navy directly on the dimmed backdrop, no panel, no
// padding. Every behavioural test passed. An overlay is exactly the kind of surface where a
// baseline earns its keep, because nothing else in the suite looks at composition.
test('links — Recently deleted panel (desktop 1280)', async ({ page }) => {
    await page.addInitScript((pats) => {
        /** @type {any} */ (window).__E2E = /** @type {any} */ (window).__E2E || {};
        /** @type {any} */ (window).__E2E.docs = [
            { id: 'd1', name: 'Option A', updatedBy: 'S. Silva', patterns: pats },
            // Clock-pinned by prep(), so this deletion is a fixed age and the countdown is stable.
            { id: 'd2', name: 'Old idea', updatedBy: 'S. Silva', patterns: pats,
              deletedAt: Date.parse('2026-07-13T09:00:00Z'), deletedBy: 'S. Silva' },
        ];
    }, LINKS_DESIGN);
    await prep(page, { width: 1280, height: 900 });
    await page.goto('/links.html');
    await page.locator('#designBinBtn').click();
    // Sentinel: the row must actually be there, or the baseline locks in an empty panel.
    await expect(page.locator('#designBinList .bin-row')).toHaveCount(1);
    await expect(page.locator('.bin-row-meta')).toContainText('Deleted');
    await settle(page, '#designBinContent');
    await expect(page.locator('#designBinContent')).toHaveScreenshot('links-recently-deleted.png');
});

// ── Guide pages (static, auth-free) ────────────────────────────────────────────────────────
// The four guides don't import shared.css and have no Firebase/fractional-grid, so they baseline
// cleanly. These lock the layouts touched by Section C (the .chip/.chip-bar hoist into
// guide-shell.css) and Section D (railcard min-fare + FIP content edits). No prep(): guides need
// no session/clock — just a viewport, fonts, and layout settle.
async function guideSettle(page, ready) {
    await expect(page.locator(ready).first()).toBeVisible();
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
}

test('guide — railcard mobile 390', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 6200 });
    await page.goto('/railcard-guide.html');
    await guideSettle(page, '.chip-bar, .rc');
    await expect(page).toHaveScreenshot('railcard-guide-mobile-390.png');
});

// Baselined at MOBILE, like its sibling the railcard guide: this is a gateline page, read on a phone.
// The composition worth locking is the card stack + the source banner — and the banner especially,
// because it is the one element whose disappearance would change what the page CLAIMS rather than
// how it looks, and no behavioural test asserts a background.
//
// THE SENTINELS EARNED THEIR KEEP AT v20.10 and are worth reading before changing. They asserted the
// v20.05 state — a draft banner and nine draft cards — and failed the moment the evidence model
// moved to per-product. That is the intended behaviour, not friction: without them the run would
// have regenerated a green baseline of a page whose claims had changed, and the change would have
// entered the repo as a picture nobody compared against anything.
test('guide — rangers & rovers mobile 390', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 6200 });
    await page.goto('/rangers-guide.html');
    // The banner still exists, but it now SUMMARISES rather than blankets.
    await expect(page.locator('.source-banner')).toBeVisible();
    // AND THEY EARNED IT AGAIN AT v20.37, in the same way. The counts below were `conflict: 2,
    // draft: 0` and failed when evidence moved from the PRODUCT to the CLAIM — which is exactly the
    // change a regenerated screenshot would have swallowed silently.
    //
    // The provisional total is still TWO, and that is the number to keep pinned; what changed is
    // where each one sits. Thames 7-Day keeps a whole-card marker, because the disputed claim (is
    // Chiltern an operator?) IS that card's Chiltern answer. Counting the two shapes separately is
    // the point — collapsing them back into one number is how the distinction gets lost.
    //
    // AND THEY MOVED AGAIN AT v20.43, which is why `draft` is now ZERO rather than deleted. The
    // Shakespeare card was marked Draft on the reasoning that its page could not be read at all —
    // and that was wrong: the SH1 product page was live, and sitemap silence had been mistaken for
    // an absent page. With its core sourced the CARD is green, and its one genuinely-open claim
    // (break of journey) stays marked at CLAIM level below. So the provisional total is unchanged
    // at two, now carried as one Conflict card + one unresolved claim, with no Draft anywhere.
    // Asserted as 0 on purpose: a Draft reappearing is a real event, and deleting the line would
    // make it a silent one.
    await expect(page.locator('.rr-card--conflict')).toHaveCount(1);  // Thames 7-Day
    await expect(page.locator('.rr-card--draft')).toHaveCount(0);     // none since the v20.43 fix
    await expect(page.locator('[data-guide-source="rr-shakespeare-boj"].rr-unresolved')).toHaveCount(1);
    // A Draft and a Conflict must never render alike, and a screenshot is the only thing that can
    // see it: the badges are what a reader looks at now, and the Shakespeare card shipped mid-v20.37
    // wearing "⚠ Conflict" over an absence. Pinned by CLASS here; the styling is separated by
    // guide-sources.test.mjs, which fails if the two recipes are identical.
    await expect(page.locator('.myb-status--unconfirmed, .ch-status--unconfirmed')).not.toHaveCount(0);
    await expect(page.locator('.pill-checked')).not.toHaveCount(0);
    // The Marylebone-first split itself: at least one product valid on Chiltern and NOT here. If
    // this empties, the page has lost the thing it was restructured to say.
    await expect(page.locator('.rr-card[data-chiltern-validity="yes"][data-myb-validity="no"]'))
        .not.toHaveCount(0);
    await guideSettle(page, '.chip-bar, .rr-card');
    await expect(page).toHaveScreenshot('rangers-guide-mobile-390.png');
});

test('guide — fip mobile 390', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 6200 });
    await page.goto('/fip.html');
    await guideSettle(page, '.chip-bar, .section-label');
    await expect(page).toHaveScreenshot('fip-guide-mobile-390.png');
});

test('guide — staff/admin desktop 900', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 3600 });
    await page.goto('/guide.html');
    await guideSettle(page, '.content, main, .guide-header');
    await expect(page).toHaveScreenshot('staff-guide-desktop-900.png');
});

test('guide — paycalc-guide desktop 900', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 3600 });
    await page.goto('/paycalc-guide.html');
    await guideSettle(page, '.content, main, .guide-header');
    await expect(page).toHaveScreenshot('paycalc-guide-desktop-900.png');
});

// ── Overlays (v19.03) ─────────────────────────────────────────────────────────
//
// WHY THESE EXIST. Until now the suite baselined ten PAGE surfaces and not one overlay — so the
// login card, About, App Notices, Tips, the dialogs and the password-force block had NO pixel
// coverage at all. That is a large fraction of the app's surface area, and it is precisely where the
// v19.04 audit found real drift: five widths, three viewport caps (85 / 86 / 90vw), two different
// width idioms and six paddings across seven overlays, with no evident reason for any of it.
//
// Any fix to that moves pixels, and nothing would have caught a mistake. So these land FIRST, on the
// CURRENT values, deliberately baselining the drift — that is what makes any consolidation a
// reviewable diff rather than a leap.
//
// Captured at a fixed 900px-tall desktop viewport: the overlay is centred and the page behind it is
// already locked by the surface baselines above, so the frame is stable.

test('overlay — About lightbox (calendar, desktop 1280)', async ({ page }) => {
    await prep(page, { width: 1280, height: 900 });
    await page.goto('/');
    await settle(page, '.calendar-day');
    await page.locator('.title-icon').first().click();
    await expect(page.locator('#iconLightbox')).toBeVisible();
    // The open transition finishes before capture (createLightbox's .visible -> .open).
    await page.evaluate(() => new Promise(r => setTimeout(r, 400)));
    await expect(page).toHaveScreenshot('overlay-about-desktop-1280.png');
});

// THE NAV DRAWER HAD NO PIXEL COVERAGE AT ALL (added v20.06), which is how it drifted into five
// competing visual treatments before anybody called it cluttered. It is the app's most-shared
// component — one module rendering on all six pages — so a regression here is a regression
// everywhere, and none of the other baselines can see it because they are all captured with the
// drawer CLOSED.
//
// Captured at 390 MOBILE, where the constraint actually bites: the drawer is `min(260px, 72vw)`, and
// 260px is what makes a two-column pill grid impossible (Calendar needs 135px of a 110px column).
// A desktop shot would never show that.
test('nav drawer — default state (mobile 390)', async ({ page }) => {
    await prep(page, { width: 390, height: 844 });
    await page.goto('/');
    await settle(page, '.calendar-day');
    await page.locator('#navMenuBtn').click();
    // Sentinels before the capture. Without them a regression that re-packed the pills or flipped
    // the Reference default would just re-baseline as the new truth on the next regeneration (the
    // Usage-card lesson, v19.25).
    //
    // Reference is EXPANDED by default again (v20.09, owner) — v20.06 closed it on a fold
    // measurement, and the owner's call is that a collapsed section is one you have to know is
    // there. Asserted here as a DECISION rather than left to the pixels: the guides must be present
    // and visible, and the toggle must agree with them. Both halves matter, because
    // `aria-expanded` and the list's `hidden` were two copies of one state until v20.09 and the
    // arrow's rotation drifted from exactly that.
    await expect(page.locator('#navGuidesToggle')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#navGuidesList')).toBeVisible();
    await expect(page.locator('#navGuidesList a')).toHaveCount(5);
    // The count chip is the collapsed-state affordance and must not print beside the rows it counts.
    await expect(page.locator('.nav-panel-guides-count')).toBeHidden();
    const rows = await page.evaluate(() =>
        new Set([...document.querySelectorAll('.nav-panel-pill')]
            .map(el => Math.round(el.getBoundingClientRect().top))).size);
    const pills = await page.locator('.nav-panel-pill').count();
    expect(rows, 'every pill must be on its own row — see .nav-panel-pills').toBe(pills);
    await page.evaluate(() => new Promise(r => setTimeout(r, 400)));
    await expect(page).toHaveScreenshot('nav-drawer-mobile-390.png');
});

test('overlay — App Notices (calendar, desktop 1280)', async ({ page }) => {
    await prep(page, { width: 1280, height: 900 });
    await page.goto('/');
    await settle(page, '.calendar-day');
    // App Notices sits in the collapsed Reference section since v20.06.
    await openReference(page);
    await page.locator('.nav-panel-link--notices').first().click();
    await expect(page.locator('#navNoticesLightbox')).toBeVisible();
    await page.evaluate(() => new Promise(r => setTimeout(r, 400)));
    await expect(page).toHaveScreenshot('overlay-notices-desktop-1280.png');
});

test('overlay — login card (admin, signed out, desktop 1280)', async ({ page }) => {
    await page.clock.setFixedTime(FIXED_TIME);
    await page.setViewportSize({ width: 1280, height: 900 });
    await dismissOneTimeOverlays(page);   // NO seedSession — we want the signed-out overlay
    await page.goto('/admin.html');
    await settle(page, '#loginCard');
    await expect(page).toHaveScreenshot('overlay-login-desktop-1280.png');
});

// Tips is one of the two overlays the v19.04 size consolidation MOVES (360px -> 340px), so it is
// baselined here on the OLD value first: the next run's expected/actual/diff PNGs are the
// before/after evidence for that change rather than a claim about it.
test('overlay — Tips panel (settings, desktop 1280)', async ({ page }) => {
    await prep(page, { width: 1280, height: 900 });
    await page.goto('/settings.html');
    await settle(page, '.card');
    await page.locator('.btn-card-tips').first().click();
    await expect(page.locator('#tipsLightbox')).toBeVisible();
    await page.evaluate(() => new Promise(r => setTimeout(r, 400)));
    await expect(page).toHaveScreenshot('overlay-tips-desktop-1280.png');
});

// ── The staff PIN unlock card (v20.12) ──────────────────────────────────────────────────────────
//
// Baselined because it is the app's front door for anybody who is not signed in, it is composed of
// nothing the rest of the suite covers, and the behavioural specs provably cannot see it: they
// assert the field exists, is labelled and is 16px+, none of which would notice the card losing its
// padding, its badge, or its surface — the exact way the links "Recently deleted" panel shipped as
// a transparent box at v19.41 with every behavioural test green.
// The PIN ships switched OFF (v20.17, deployed dark), so these must turn it on rather than inherit
// the default — otherwise the front door stops being baselined the day it ships and nobody notices,
// which is the failure mode this whole file exists to prevent.
test('calendar — staff PIN unlock card @1280', async ({ page }) => {
    await page.clock.setFixedTime(FIXED_TIME);
    await enableCalendarPin(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/index.html');
    await settle(page, '#calLockPin');
    await expect(page).toHaveScreenshot('calendar-lock-desktop-1280.png');
});

test('calendar — staff PIN unlock card @390', async ({ page }) => {
    await page.clock.setFixedTime(FIXED_TIME);
    await enableCalendarPin(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/index.html');
    await settle(page, '#calLockPin');
    await expect(page).toHaveScreenshot('calendar-lock-mobile-390.png');
});


// ── Overtime ──────────────────────────────────────────────────────────────────────────────────
// Both surfaces, because they are visually different pages that happen to share a shell: the
// member's seven-day form and the reviewer's planning horizon. The page shipped with NO baseline
// at all, which is how six composition defects — a duplicate page title, a gold banner, a gold tab
// slab, an uncoloured header chip, a width 80px off its stated family — reached production
// together and were found by eye rather than by a diff.
//
// The endpoints are stubbed at fixed dates rather than derived from FIXED_TIME, so the rendered
// deadlines are stable text. A window derived from the clock would re-word itself whenever the
// pinned time moved and quietly invalidate the baseline.
const OT_WINDOW = {
    weekEnding: '2026-08-01', weekStart: '2026-07-26',
    initialDeadlineAt: Date.parse('2026-07-14T11:00:00Z'), draftRosterDate: '2026-07-16',
    finalDeadlineAt: Date.parse('2026-07-21T11:00:00Z'), finalRosterDate: '2026-07-23',
    retentionUntil: Date.parse('2026-10-31T00:00:00Z'), policyVersion: 1, audience: 'restricted',
};

/** @param {import('@playwright/test').Page} page */
function stubOvertime(page, { windows = [], weeks = [] } = {}) {
    const now = FIXED_TIME.getTime();
    return Promise.all([
        page.route('**/getMyOvertimeState', r => r.fulfill({
            status: 200, contentType: 'application/json',
            body: JSON.stringify({ ok: true, serverNow: now, windows }),
        })),
        page.route('**/getOvertimeManagerOverview', r => r.fulfill({
            status: 200, contentType: 'application/json',
            body: JSON.stringify({ ok: true, serverNow: now, planningWeeks: weeks, retained: [] }),
        })),
    ]);
}

test('overtime — the member form, seven days unanswered (mobile 390)', async ({ page }) => {
    await prep(page, { width: 390, height: 1800 });
    await stubOvertime(page, {
        windows: [{ ...OT_WINDOW, phase: 'INITIAL_OPEN', participant: { grade: 'CEA', rosterOrder: 2 }, submission: null }],
    });
    await page.goto('/overtime.html');
    await settle(page, '.ot-day');
    // Sentinel: all seven days are in the frame. Without it a viewport trim would silently drop
    // the tail of the form and regenerate as though the shorter page were correct.
    await expect(page.locator('.ot-day')).toHaveCount(7);
    await expect(page.locator('.ot-submit')).toBeInViewport();
    await expect(page).toHaveScreenshot('overtime-member-mobile-390.png');
});

test('overtime — a day ANSWERED, with the willingness tick (mobile 390)', async ({ page }) => {
    // The v21.24 split put a SECOND question on each day, and it is invisible in the two baselines
    // above because it only appears once that day has an available answer. So the one control this
    // release adds had no picture of it at all — and it is a checkbox in a design that is otherwise
    // entirely pills, which is exactly the kind of thing that renders wrong without failing a test.
    //
    // Two days answered, deliberately: one with the tick on and one with it off, so the frame
    // carries both states and a CSS change that flattened the difference would show here.
    await prep(page, { width: 390, height: 1800 });
    await stubOvertime(page, {
        windows: [{ ...OT_WINDOW, phase: 'INITIAL_OPEN', participant: { grade: 'CEA', rosterOrder: 2 }, submission: null }],
    });
    await page.goto('/overtime.html');
    await settle(page, '.ot-day');
    const days = page.locator('.ot-day');
    await days.nth(0).locator('[data-mode="all_day"]').click();
    await days.nth(0).locator('[data-fulltwelve]').check();
    await days.nth(1).locator('[data-mode="all_day"]').click();
    await expect(days.nth(0).locator('[data-fulltwelve]')).toBeChecked();
    await expect(days.nth(1).locator('[data-fulltwelve]')).not.toBeChecked();
    await expect(page).toHaveScreenshot('overtime-member-answered-mobile-390.png');
});

test('overtime — the member form on the desktop band (desktop 1280)', async ({ page }) => {
    // The DAY ROW is the whole design at this width — day, roster badge, then the run of options —
    // and its shape is the thing v21.15 changed: the seven options used to need 814px in a 786px
    // row, so five of the seven days wrapped one lonely "Custom times" under a full line with ~690px
    // of nothing beside it. Two independently-argued changes (the left column stops hoarding 20px it
    // never uses; the pills take desktop density like every other pill family in the app) leave it
    // on one line — a consequence, not a contract, which is exactly why it is worth a picture.
    //
    // A behavioural test cannot see this. The buttons were all present, all clickable and all the
    // right size before the change; only their arrangement was wrong.
    await prep(page, { width: 1280, height: 1200 });
    // A week the seeded member actually WORKS, unlike the mobile baseline's spare week. That is the
    // whole point of this picture: a rest day offers four options and always fitted, and a worked
    // day offers the anchored run — the case that wrapped (seven options until the v21.22 fold
    // removed the all_day duplicate; six since). Five worked days and two rest days here, so the
    // frame carries both shapes and the badge column can be seen aligning down the two.
    await stubOvertime(page, {
        windows: [{ ...OT_WINDOW, weekEnding: '2026-09-26', weekStart: '2026-09-20',
            // Milestones moved with the week (18 and 11 days before the Saturday, as the real
            // timetable puts them). Inheriting OT_WINDOW's would print July deadlines above a
            // September week — harmless to the layout, and an invitation to somebody later to go
            // looking for a date bug that is only in the fixture.
            initialDeadlineAt: Date.parse('2026-09-08T11:00:00Z'), draftRosterDate: '2026-09-10',
            finalDeadlineAt: Date.parse('2026-09-15T11:00:00Z'), finalRosterDate: '2026-09-17',
            phase: 'INITIAL_OPEN',
            participant: { grade: 'CEA', rosterOrder: 2 }, submission: null }],
    });
    await page.goto('/overtime.html');
    await settle(page, '.ot-day');
    await expect(page.locator('.ot-day')).toHaveCount(7);
    // Sentinels, so a regenerated baseline cannot quietly bless the defect coming back: a worked day
    // shows the five anchored options (no all_day since the v21.22 fold, no twelve_hours since the
    // v21.24 availability/willingness split), and they sit on ONE line.
    const worked = page.locator('.ot-day').first().locator('.ot-mode');
    await expect(worked).toHaveCount(5);
    const lines = await page.locator('.ot-day').first().locator('.ot-modes').evaluate(g =>
        new Set([...g.querySelectorAll('.ot-mode')]
            .map(b => Math.round(b.getBoundingClientRect().top))).size);
    expect(lines, 'a worked day\'s options, in rows').toBe(1);
    await expect(page).toHaveScreenshot('overtime-member-desktop-1280.png');
});

test('overtime — the planning horizon, every row state (desktop 1280)', async ({ page }) => {
    await prep(page, { width: 1280, height: 1000 });
    await stubOvertime(page, {
        weeks: [
            { ...OT_WINDOW, weekEnding: '2026-07-18', exists: false, state: 'missed', canCreate: false },
            // A created week whose deadline has gone (v20.69). It is the FIRST row in production —
            // the horizon always opens on the current week — so a baseline without one was a
            // picture of a horizon nobody ever sees.
            { ...OT_WINDOW, weekEnding: '2026-07-25', exists: true, state: 'created-closed',
                canCreate: false, expected: 4, received: 4, noResponse: 0 },
            { ...OT_WINDOW, exists: true, state: 'created', canCreate: false, expected: 4, received: 1, noResponse: 3 },
            { ...OT_WINDOW, weekEnding: '2026-08-08', exists: false, state: 'not-created', canCreate: true },
            { ...OT_WINDOW, weekEnding: '2026-08-15', exists: false, state: 'not-created-initial-passed', canCreate: true },
        ],
    });
    await page.goto('/overtime.html');
    await settle(page, '.ot-week-row');
    // Every tone present — the point of this baseline is the row treatment, and a fixture that
    // happened to render one state would lock a picture of nothing in particular.
    await expect(page.locator('.ot-week-row')).toHaveCount(5);
    await expect(page).toHaveScreenshot('overtime-horizon-desktop-1280.png');
});
