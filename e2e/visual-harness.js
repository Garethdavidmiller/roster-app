// @ts-check
/**
 * visual-harness.js — THE DETERMINISM LEVERS, IN ONE PLACE.
 *
 * Three specs capture pixels: `visual.spec.js` (Chromium, the screen), `print-visual.spec.js`
 * (the rasterised first sheet) and `visual-webkit.spec.js` (Safari's engine). All three need the
 * same page to come up the same way every run, and they were about to hold three copies of the
 * setup that makes that true.
 *
 * **A harness that drifts produces a FLAKY BASELINE, and a flaky baseline is worse than none** —
 * that is this repo's own rule, written in `visual.spec.js`'s header about the mobile calendar and
 * acted on there by dropping the surface. Three copies of a determinism recipe is the most
 * reliable way to get one: a lever added to the file somebody happened to be editing, and two
 * suites that now settle differently for reasons nobody can see in a diff.
 *
 * So the levers live here, once. What each is for is stated where it is set, because the reason is
 * the part that stops somebody "simplifying" it:
 *
 *   · the CLOCK is pinned, so the month, the "Today" cell and the pay period do not move;
 *   · `setFixedTime` and NOT `clock.install`, which halts the timer queue and stalls paycalc's
 *     timer-driven init;
 *   · Firebase is stubbed by `fixtures.js`, so every read is empty;
 *   · a fixed member is seeded, with a restorable Firebase identity as well as a local session —
 *     since v20.12 `decideAccess` needs BOTH, and a session alone captures the staff-PIN card
 *     instead of the roster on every calendar surface;
 *   · every one-time overlay is pre-dismissed, so no lightbox floats over the capture;
 *   · and the settle waits on the page rather than on a clock — visible, network idle, fonts
 *     loaded, two frames painted.
 *
 * The FONT wait is the one that looks optional and is not: a capture taken before
 * `document.fonts.ready` gets fallback metrics, which moves text a pixel or two everywhere and
 * reads as a whole-page drift.
 */

import { expect } from './fixtures.js';
import { seedSession, seedMember } from './helpers.js';

/** A Wednesday inside G. Miller's rendered roster window — a stable "Today" cell and a
 *  deterministic pay period, independent of the wall clock the suite runs on. */
export const FIXED_TIME = new Date('2026-07-15T09:00:00Z');

/** Pre-dismiss every one-time overlay/notice so no lightbox floats over the captured layout.
 *  Keys are the real localStorage flags each surface checks (kept in sync with the app). */
export function dismissOneTimeOverlays(page) {
    return page.addInitScript(() => {
        const flags = {
            'myb_pc_ytd_notice_2_shown': '1',  // paycalc Year-to-Date notice (run 2, v21.91)
            'myb_pc_ns_migrated': '1',         // paycalc legacy data-ownership prompt
            'myb_notif_prompt_done': '1',      // calendar notification prompt strip
            'myb_links_welcome_seen': '1',     // links first-visit notice
            'myb_notice_al_booking_2026_done': '1',  // the live calendar notice (v23.31)
        };
        for (const [k, v] of Object.entries(flags)) {
            try { localStorage.setItem(k, v); } catch { /* iOS private mode — ignore */ }
        }
    });
}

/**
 * Common deterministic setup. Pass `{ width, height }` to size the viewport (tall enough to
 * contain the page — see the CAPTURE STRATEGY note in `visual.spec.js`), or omit it to keep the
 * device's own viewport, which is what a `devices['iPhone 13']` project wants.
 */
export async function prep(page, size) {
    await page.clock.setFixedTime(FIXED_TIME);
    if (size) await page.setViewportSize(size);
    await seedSession(page, 'G. Miller');
    await seedMember(page, 'G. Miller');
    // The Calendar needs a restorable Firebase identity as well as a local session since v20.12 —
    // `decideAccess` requires BOTH, so a baseline seeded with only the session would capture the
    // staff-PIN card on every calendar surface instead of the roster.
    await page.addInitScript(() => { window.__E2E = Object.assign(window.__E2E || {}, { authUser: true }); });
    await dismissOneTimeOverlays(page);
}

/** Wait for the app to settle DETERMINISTICALLY: the key element visible, network idle (stubbed
 *  reads resolved), web fonts fully loaded (no FOUT metric shift), then two animation frames so
 *  the final layout has painted before we capture. */
export async function settle(page, ready) {
    await expect(page.locator(ready).first()).toBeVisible();
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
}
