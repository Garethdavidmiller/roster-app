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
        await expect(page.locator('#fieldMemberTrigger')).toBeVisible();
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
// "Shifts shown" and "Confirmed" are the ladder's two far rungs, and LATENCY.md decides
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

// ── THE RECORDED-DATES ROW KEEPS ITS CONTROLS (v23.72) ────────────────────────────────────────
// Owner bug report, with a screenshot: on the Admin page's "Recorded Annual Leave dates" list, the
// row for a long range put its ✕ on a SECOND LINE, under the date, with the day-count chip shoved
// out to the right edge. The row went from 46px to 72px and the delete control was orphaned
// beneath the thing it deletes.
//
// The cause was `flex-wrap: wrap` on `.al-period-row`, and it is worth stating because the CSS
// looked correct: `.al-period-dates` carried `min-width: 0` and an ellipsis, with a comment
// promising a long range would ellipsise "instead of forcing the row wider than the card". It
// never could. A flex container breaks LINES on its items' hypothetical sizes — before any
// shrinking runs — so the dates span asked for its full content width, the chip and the 44px
// button no longer fit beside it, and the button wrapped. The shrink that would have triggered the
// ellipsis never happened. Measured on the real card: broken at 360px at the DEFAULT text size,
// and at 412px from Android's "Largest" upward.
//
// WHY THIS IS AN E2E AND NOT A UNIT TEST: nothing about it is visible to JSDOM. The markup was
// always correct — three children in the right order with the right classes — and every existing
// suite stayed green while the row was visibly broken on a phone. Only a real engine laying out
// real CSS at a real width can see it.
//
// IT DRIVES THE REAL RENDERER. `admin-booked-periods.js` imports nothing and takes every handle
// injected, so the page can build it with the REAL formatters, the REAL period merger and the REAL
// month abbreviations, and render into the REAL box on the REAL page. Hand-writing the row's HTML
// here would have pinned this guard to a copy of the markup that could drift out from under it —
// and the unit suite does not assert those class names, so nothing would have caught the drift.
test('recorded-dates rows keep the chip and ✕ on the row, at every width and text size', async ({ page }) => {
    await seedSession(page, 'G. Miller');
    await page.goto('/admin.html');
    await expect(page.locator('#alBookedBox')).toBeAttached();

    // 360px is the narrowest phone this app supports; 412px is the owner's Android. The type-token
    // override SIMULATES OS text enlargement: Android scales computed font sizes, and these are the
    // two fonts in the row. It is a proxy for the platform behaviour, not the platform itself.
    for (const width of [360, 390, 412]) {
        await page.setViewportSize({ width, height: 900 });
        for (const scale of [1, 1.15, 1.3, 1.5]) {
            const rows = await page.evaluate(async ({ scale }) => {
                const [bp, ou, rd, pd] = await Promise.all([
                    import('./admin-booked-periods.js'), import('./override-utils.js'),
                    import('./roster-data.js'),          import('./admin-period-dates.js'),
                ]);
                // A nine-day booking across a month end — the owner's actual row.
                const dates = ['2026-04-24','2026-04-25','2026-04-27','2026-04-28','2026-04-29',
                               '2026-04-30','2026-05-04','2026-05-05','2026-05-06'];
                const list = bp.createBookedPeriods({
                    doc: document,
                    getEntries:   () => dates.map(date => ({ date, type: 'annual_leave' })),
                    hasAuthority: () => true,
                    memberFor:    () => ({ name: 'G. Miller' }),
                    isSunday:     rd.isSunday,
                    mergePeriods: ou.mergeBookedPeriods,
                    isRestGap:    () => true,        // the gap days are rest days, so it stays ONE period
                    addDays:      pd.addDays,
                    monthAbb:     rd.MONTH_ABB,
                    fmtDate:      pd.fmtPeriodDate,
                    fmtRange:     pd.fmtPeriodRange,
                    onDelete:     () => {},
                });
                document.getElementById('alBookedBox').hidden = false;
                list.render({ type: 'annual_leave', memberName: 'G. Miller', boxId: 'alBookedBox',
                    bodyId: 'alBookedBody', countFn: n => `${n} DAY${n === 1 ? '' : 'S'}`,
                    countClass: 'al-period-count', feedbackId: 'alFeedback', preferredYear: '2026' });

                // The collapsed card would measure everything at zero height.
                let el = document.getElementById('alBookedBody');
                while (el && el !== document.documentElement) {
                    el.hidden = false;
                    const cs = getComputedStyle(el);
                    if (cs.display === 'none')  el.style.display = 'block';
                    if (cs.maxHeight === '0px') el.style.maxHeight = 'none';
                    el = el.parentElement;
                }
                document.documentElement.style.setProperty('--type-label', (13 * scale).toFixed(1) + 'px');
                document.documentElement.style.setProperty('--type-micro', (10 * scale).toFixed(1) + 'px');

                return [...document.querySelectorAll('.al-period-row')].map(row => {
                    const d   = row.querySelector('.al-period-dates');
                    const c   = row.querySelector('.al-period-count');
                    const btn = row.querySelector('.btn-period-delete');
                    const dr = d.getBoundingClientRect(), cr = c.getBoundingClientRect(),
                          br = btn.getBoundingClientRect();
                    return {
                        text: d.textContent.trim(),
                        // A control that has dropped to its own line starts at or below the date's
                        // bottom edge. Comparing against the date's TOP would false-alarm the moment
                        // the date itself wraps to two lines, which is the fix working.
                        chipWrapped: cr.top >= dr.bottom - 2,
                        btnWrapped:  br.top >= dr.bottom - 2,
                        // And the date must stay readable — the range's END is what says how long
                        // the booking is, and it is the half an ellipsis would eat.
                        clipped: d.scrollWidth > d.clientWidth + 1 || d.scrollHeight > d.clientHeight + 1,
                    };
                });
            }, { scale });

            expect(rows.length, `no rows rendered at ${width}px — the guard measured nothing`).toBeGreaterThan(0);
            const broken = rows.filter(r => r.chipWrapped || r.btnWrapped || r.clipped)
                .map(r => `"${r.text}"${r.btnWrapped ? ' ✕ on its own line' : ''}`
                        + `${r.chipWrapped ? ' chip on its own line' : ''}${r.clipped ? ' date truncated' : ''}`);
            expect(broken, `at ${width}px and ${scale}× text, the recorded-dates row broke:\n  ${broken.join('\n  ')}`)
                .toEqual([]);
        }
    }
});
