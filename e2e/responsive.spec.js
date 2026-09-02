import { test, expect, enforceNamedSession, enableInplaceLogin, enableCalendarPin } from './fixtures.js';
import { collectFatalErrors, seedSession, seedMember, pickFirstMemberAndPassword, DESKTOP_WIDTHS, armEnforcementWithFailingSignIn, signInThroughOverlay, seedViewerAccess } from './helpers.js';

// ── Calendar access (v20.12) ────────────────────────────────────────────────────────────────────
// Since v20.12 the Calendar opens only for a member session or the shared staff PIN, so a spec that
// simply loads index.html now gets the unlock card and none of the roster. Every test in this file
// is about what the Calendar DOES once it is open, not about the gate, so each page starts with a
// viewer session already in place — the state an unlocked shared office PC is in, and the closest
// match to what these tests were implicitly written against (roster on screen, `getSession()` null).
// The gate itself is covered end-to-end in calendar-pin.spec.js.
// A test that also seeds a member session still gets the member: the stub ranks them that way,
// exactly as `decideAccess` does.
// These set the PIN explicitly rather than inheriting `CONFIG.CALENDAR_PIN_ACCESS`, and seed a
// viewer session to satisfy it. Deliberate, and the value is NOT restated here — `roster-data.js`
// owns it, and a comment repeating it is the defect this repo names most often (this one did, and
// said "switched OFF … deployed dark" for the five weeks after the flag went live). A suite that
// INHERITS the flag silently changes what it covers on the day the flag moves, and the direction
// that costs something is a calendar suite falling back to the old open model with the gate
// untested.
test.beforeEach(async ({ page }) => { await enableCalendarPin(page); await seedViewerAccess(page); });


// ── DESKTOP GEOMETRY (added v14.37) ───────────────────────────────────────
// The unit/maths suites never see layout; only a rendered viewport catches
// horizontal overflow, off-screen primary content, or CSS-grid column traps.
// These extend the existing paycalc/operations desktop checks (1280/1440px) down
// to 1024px (the desktop breakpoint edge) and out to the calendar, team view and
// signed-in admin — plus a short-height laptop case where sticky chrome and tall
// content most often misbehave. A single horizontal scrollbar is the cheapest,
// most reliable signal that a desktop layout has broken.


// CALENDAR — the most-used page, and anonymous (no session needed).
for (const width of DESKTOP_WIDTHS) {
    test(`calendar desktop @${width}px: renders, no horizontal overflow`, async ({ page }) => {
        const errors = collectFatalErrors(page);
        await page.setViewportSize({ width, height: 800 });
        await seedMember(page);
        await page.goto('/');
        await expect(page.locator('.month-year')).toBeVisible();
        await expect(page.locator('.calendar-day').first()).toBeVisible();
        const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, 'no horizontal overflow on desktop calendar').toBeLessThanOrEqual(1);
        expect(errors, 'Uncaught JS exceptions on desktop calendar').toHaveLength(0);
    });
}

// CALENDAR short height — a 1024×720 laptop. Guards against the sticky header or an
// oversized control row forcing the page wider (or producing a stray scrollbar).
test('calendar desktop @1024×720 (short height): renders, no horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 720 });
    await seedMember(page);
    await page.goto('/');
    await expect(page.locator('.month-year')).toBeVisible();
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, 'no horizontal overflow on a short-height desktop').toBeLessThanOrEqual(1);
});

// TEAM VIEW — the wide week grid must scroll INSIDE its wrapper, never widening the
// page. A regression where .team-table-wrap loses overflow-x:auto would push the
// whole document wide; this catches that.
test('team view desktop @1280px: grid renders, table scrolls internally without page overflow', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await seedMember(page);
    await page.goto('/');
    await expect(page.locator('#teamMemberSelect option').first()).toBeAttached();
    await page.locator('#teamViewBtn').click();
    // calendar-team-view.js renders the week grid into #calendarDisplay.
    await expect(page.locator('.team-table-wrap')).toBeVisible();
    await expect(page.locator('.grade-tab').first()).toBeVisible();
    const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, 'team table must scroll internally, not overflow the page').toBeLessThanOrEqual(1);
    expect(errors, 'Uncaught JS exceptions in team view').toHaveLength(0);
});

// ADMIN (signed in) — the member selector and override cards must lay out without
// horizontal overflow across the desktop widths. The login-overlay tests above only
// exercise the logged-OUT page; this covers the actual admin working surface.
for (const width of DESKTOP_WIDTHS) {
    test(`admin desktop @${width}px (signed in): selector + cards reachable, no overflow`, async ({ page }) => {
        const errors = collectFatalErrors(page);
        await page.setViewportSize({ width, height: 900 });
        await seedSession(page, 'G. Miller');   // admin
        // Suppress the one-time work-email overlay so it doesn't cover the page.
        await page.goto('/admin.html');
        // Signed in → the login overlay is never made .visible, and the admin UI shows.
        await expect(page.locator('#loginOverlay')).toBeHidden();
        await expect(page.locator('#fieldMember')).toBeVisible();
        const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, 'no horizontal overflow on desktop admin').toBeLessThanOrEqual(1);
        expect(errors, 'Uncaught JS exceptions on signed-in admin').toHaveLength(0);
    });
}

// PAY CALCULATOR short height — a 1280×720 laptop. The result card is the primary
// output; on a short viewport it sits below the fold (reached by scrolling), but the
// page itself must not overflow horizontally and the result card must still render.
test('paycalc desktop @1280×720 (short height): result card renders, no horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await seedSession(page);
    await page.addInitScript(() => {
        localStorage.setItem('myb_pc_ns_migrated', '1');
    });
    await page.goto('/paycalc.html');
    await expect(page.locator('.result-card')).toBeVisible();
    const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, 'no horizontal overflow on a short-height paycalc').toBeLessThanOrEqual(1);
});


// ── ADMIN WEEK LABEL at 375px (v18.91) ────────────────────────────────────
// The documented primary width, and the one control the whole Change-a-Shift card hangs off. This
// label regressed twice in two versions without anyone noticing: v18.89 reclaimed 14px from the row
// (replacing padding with `gap`) so six cross-month weeks began to ellipsise, and v18.90 then
// collapsed only the SAME-month form — which made today's week look fixed while those six still
// clipped. What gets cut is the trailing 📅, the date picker's only affordance, so the failure is
// silent unless you happen to be on one of those weeks.
//
// Every prior check here was "does the PAGE overflow", which this never triggered — the label
// ellipsises inside its own box, so the page stays clean. Measuring scrollWidth vs clientWidth on
// the element itself is what catches it. 57 weeks covers 13 months, so every cross-month boundary
// (including the long "30 Aug–5 Sep 2026" shape) is exercised.
// ONE real click, then the walk happens INSIDE the page (v21.40). This used to be 57 Playwright
// clicks — 114 protocol round-trips at ~9s per project, which sat close enough to the 30s test
// budget that a loaded CI runner pushed it over: it was the webkit job's one REPEAT offender
// (three red runs, mobile-safari every time), and a retry cannot save it because the retry runs
// on the same busy runner. The loop is safe to move in-page because `shiftWeek` is SYNCHRONOUS —
// the label is rewritten inside the click handler with no awaited step, and `swipeCooldown` only
// arms during a real pointer swipe — so `btn.click()` produces byte-identical label text and the
// scrollWidth read after it forces the same layout Playwright's click path would have measured.
// The first click stays a real one so the button's own wiring keeps a browser-driven check.
test('admin week label fits at 375px for every week across 13 months', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await seedSession(page, 'G. Miller');
    await page.goto('/admin.html');
    await expect(page.locator('#weekNavLabel')).toBeVisible();

    const measure = () => page.evaluate(() => {
        const el = document.getElementById('weekNavLabel');
        return { text: el.textContent, sw: el.scrollWidth, cw: el.clientWidth };
    });
    const first = await measure();
    await page.locator('#nextWeekBtn').click();
    const second = await measure();

    // The remaining 55 weeks in one evaluate: measure, click, repeat.
    const rest = await page.evaluate(() => {
        const el  = document.getElementById('weekNavLabel');
        const btn = document.getElementById('nextWeekBtn');
        const out = [];
        for (let i = 0; i < 55; i++) {
            btn.click();
            out.push({ text: el.textContent, sw: el.scrollWidth, cw: el.clientWidth });
        }
        return out;
    });

    const overflowing = [first, second, ...rest]
        .filter(r => r.sw > r.cw)
        .map(r => `${r.text} (${r.sw}px into ${r.cw}px)`);
    expect(overflowing, `week labels ellipsising at 375px — the 📅 affordance is cut off:\n${overflowing.join('\n')}`)
        .toEqual([]);
});

// ── Team View must reach BOTH ends of the boot ladder (v21.37, external review) ────────────────
// "Shifts shown" and "Confirmed" are the ladder's two far rungs, and LATENCY_PLAN.md decides
// whether narrower Firestore reads are worth doing from the GAP between them. Team View recorded
// the first and never the second, so every launch spent there widened that gap for free.
//
// IT MUST BE A RESTORE, NOT A CLICK. The first version of this asserted after clicking into Team
// View from the Calendar — and passed with the bug fully present, because the Calendar had already
// marked `rosterLive` on its own render before the click. Three mutations all survived it. Seeding
// `myb_team_view` makes Team View the BOOT surface, so the Calendar never renders and the mark can
// only come from the path under test.
test('team view restored at boot records the roster-live milestone, not just page-ready', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await seedMember(page);
    await page.addInitScript(() => localStorage.setItem('myb_team_view', '1'));
    await page.goto('/');
    await expect(page.locator('.team-table-wrap')).toBeVisible();

    await expect.poll(async () => page.evaluate(() =>
        performance.getEntriesByType('mark').map(m => m.name)
    ), { message: 'a Team View boot must record the roster-live mark once its grid is authoritative' })
        .toContain('myb-roster-live');
});
