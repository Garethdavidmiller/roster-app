/**
 * calendar-phone-layout.spec.js — the Calendar (index.html): the page at phone widths and under text
 * scaling — the legend, the action row, the month heading, the week row and the loading shape.
 *
 * Split by feature out of calendar.spec.js on 25 Nov 2026, test for test and unchanged; what more than
 * one calendar-*.spec.js file needs is in calendar-helpers.js. Every file keeps the old file's
 * `beforeEach`, so each test still starts signed in as a member. The Calendar's access gate is
 * calendar-access.spec.js.
 */
import { test, expect } from './fixtures.js';
import { CONFIG } from '../roster-data.js';
import { seedMember, seedCalendarMember, seedMemberSession, isTouchProject, scaleText } from './helpers.js';

// ── Calendar access ─────────────────────────────────────────────────────────────────────────────
// The Calendar opens only for a signed-in member (since the staff PIN was retired, 23 Nov 2026; from
// v20.12 the PIN opened it too), so a spec that simply loads index.html gets the sign-in card and none
// of the roster. Every test in this file is about what the Calendar DOES once it is open, not about
// the gate, so each page starts signed in as a member with no calendar picked on this device
// (`seedCalendarMember`) — the member's own calendar. Until the PIN went it started on a PIN viewer,
// whose `getSession()` was null; the tests that existed only for that state (the first-run prompt,
// the station PC's Team View and bug report) went with it. The gate itself is calendar-access.spec.js.
test.beforeEach(async ({ page }) => { await seedCalendarMember(page); });

// A BALANCED LEGEND AT 1024px (polish round 2). As a flex row the keys wrapped greedily, so a busy
// month — RDW, leave, an absence and an Other day on top of the fixed keys — put "✂️ Pay cut-off" and
// "💷 Payday" alone on a second line (measured: 10 keys over 2). The four conditional keys are
// revealed by hand here, exactly as `legendVisibility` would for such a month, so the test does not
// depend on what today's fixture month happens to contain.
test('calendar: a legend that wraps at 1024px wraps into EVEN lines', async ({ page }) => {
    await seedMember(page);
    await page.setViewportSize({ width: 1024, height: 800 });
    await page.goto('/');
    await expect(page.locator('.legend')).toBeVisible();
    await page.evaluate(() => {
        for (const id of ['legend-rdw', 'legend-al', 'legend-sick', 'legend-other']) {
            const el = document.getElementById(id);
            if (el) el.style.display = '';
        }
        const row = document.getElementById('legend-row-2');
        if (row) row.style.display = '';
    });
    const lines = await page.evaluate(() => {
        // A LINE IS A BAND, NOT A PIXEL ROW (v24.48, external audit T1). Grouping by the rounded
        // `top` split one visual line into two when a taller key (Pay cut-off) sat half a pixel
        // above its neighbours — 824 against 824.5 — and the test then reported three lines. Items
        // whose vertical centres are within a few pixels share a line.
        /** @type {Array<{ mid: number, n: number, left: number, right: number }>} */
        const bands = [];
        for (const el of document.querySelectorAll('.legend-item')) {
            const r = el.getBoundingClientRect();
            if (!r.width) continue;
            const mid = r.top + r.height / 2;
            let l = bands.find(b => Math.abs(b.mid - mid) < 6);
            if (!l) bands.push(l = { mid, n: 0, left: r.left, right: r.right });
            l.n++; l.left = Math.min(l.left, r.left); l.right = Math.max(l.right, r.right);
        }
        return bands.map(l => ({ n: l.n, width: Math.round(l.right - l.left) }));
    });
    expect(lines.length, 'this many keys must still need two lines at 1024px, or the test proves nothing').toBe(2);
    const [a, b] = lines.map(l => l.width);
    expect(Math.min(a, b) / Math.max(a, b),
        `the two legend lines are ${a}px and ${b}px — the shorter must not be a stub (${JSON.stringify(lines)})`)
        .toBeGreaterThan(0.6);
});

// ─── 360px: THE WIDTH NOTHING RENDERED ────────────────────────────────────────────────────────
// A staff report from a 360px Samsung A-series, v22.62: the quick-action row — 📍 · Team · AL ·
// Admin · Pay — measured 366px against 322px of usable width, so it overflowed by 6px at the
// DEFAULT font size, and `justify-content: center` pushed it off both edges where `overflow-x:
// clip` cut it. Newer phones are 412px and never showed it.
//
// The reason it shipped is the interesting part, and it is a coverage hole rather than a coding
// mistake: the mobile e2e project is Pixel 5 at 393px, the visual baselines are 390px, and the row
// first fits at 384px. Every automated eye sat just above the threshold, on the one width band that
// is by far the commonest on Android. So this asserts the width itself.
//
// It checks the RENDERED GEOMETRY, not the CSS: a fix expressed as wrapping, as tighter spacing or
// as shorter labels should all pass, and only "a member can see the buttons" is being pinned.
// The FONT-SCALED cases are not padding: they are what proves the WRAP is load-bearing. Teeth-check
// on the first cut of this guard — deleting the wrap and restoring `flex-shrink: 0` left all three
// default-size cases GREEN, because the tighter spacing alone fits five buttons at 14px. The wrap
// only earns its keep once Chrome's text scaling grows them, which is the setting an older phone is
// most likely to have turned up. `--type-body` is a fixed px, so scaling `html { font-size }` would
// have measured nothing (it did, in the first attempt to reproduce this bug) — the override has to
// hit the buttons themselves.
for (const [width, fontPx] of [[320, 14], [360, 14], [375, 14], [360, 18], [360, 22], [412, 20]]) {
    test(`calendar: the quick-action row stays on screen at ${width}px / ${fontPx}px text`, async ({ page }) => {
        await seedMember(page);
        await seedMemberSession(page);
        await page.setViewportSize({ width, height: 740 });
        await page.goto('/');
        await page.waitForSelector('.control-group--actions', { state: 'attached' });
        if (fontPx !== 14) {
            await page.addStyleTag({ content:
                `.controls select, .controls button { font-size: ${fontPx}px !important; }` });
        }
        await page.waitForTimeout(400);

        const geo = await page.evaluate((vw) => {
            const group = document.querySelector('.control-group--actions');
            const buttons = [...group.querySelectorAll('button')];
            const r = group.getBoundingClientRect();
            return {
                left: r.left, right: r.right,
                offscreen: buttons
                    .map(b => ({ label: b.textContent.trim(), r: b.getBoundingClientRect() }))
                    .filter(b => b.r.left < -0.5 || b.r.right > vw + 0.5)
                    .map(b => b.label),
                smallest: Math.min(...buttons.map(b => b.getBoundingClientRect().width)),
                shortest: Math.min(...buttons.map(b => b.getBoundingClientRect().height)),
                count: buttons.length,
                // Grouped by rendered TOP, so this reads the wrap the browser actually performed
                // rather than the DOM order or any CSS the fix happens to be expressed in.
                lines: [...new Set(buttons.map(b => Math.round(b.getBoundingClientRect().top)))]
                    .sort((a, b) => a - b)
                    .map(top => buttons
                        .filter(b => Math.round(b.getBoundingClientRect().top) === top)
                        .map(b => b.textContent.trim())),
            };
        }, width);

        expect(geo.count).toBe(5);
        expect(geo.offscreen, `clipped at ${width}px/${fontPx}px: ${geo.offscreen.join(', ')}`).toEqual([]);
        expect(geo.left).toBeGreaterThanOrEqual(-0.5);
        expect(geo.right).toBeLessThanOrEqual(width + 0.5);
        // Wrapping must not be bought with an untappable control. 24px is WCAG 2.5.8 AA; v22.61 set
        // a 30px floor for coarse pointers on the Link Designer chips and the same standard applies here.
        expect(geo.smallest).toBeGreaterThanOrEqual(30);
        expect(geo.shortest).toBeGreaterThanOrEqual(30);

        // AND THE SHAPE OF THE WRAP, which is the half this guard was missing (v22.83). Everything
        // above passed on the 4 + 1 wrap the owner then reported from the same 360px Samsung: a
        // lone centred "💷 Pay" under four buttons, reading as a fault rather than as a second
        // line, and 95px of a phone that had none to spare. Nothing was off screen, so "not
        // clipped" was true and the row still looked broken.
        //
        // Either the five fit on ONE line, or they break 3 + 2 — never 4 + 1, never 2 + 3. The
        // exact split is asserted rather than a softer "no line has one button", because that
        // weaker rule is also satisfied by 1 + 4, which is the same widow at the other end.
        expect(geo.lines.length, `${width}px/${fontPx}px wrapped onto ${geo.lines.length} lines`)
            .toBeLessThanOrEqual(2);
        expect(geo.lines.map(l => l.length), `${width}px/${fontPx}px: ${JSON.stringify(geo.lines)}`)
            .toEqual(geo.lines.length === 1 ? [5] : [3, 2]);
    });
}

// ─── THE ROW ABOVE IT, AND THE ONE THING NO OVERFLOW CHECK CAN SEE ───────────────────────────────
// v22.63 fixed the quick-action row and nobody re-measured the nav row directly above it. At 320px
// it was 334px into 300px, so `← Prev` and `Next →` each hung 14px off an edge and were cut by the
// body's `overflow-x: clip`. Letting the member-select group shrink fixed that and introduced a
// WORSE failure for one release: the group shrank, the select kept its 200px `max-width`, and the
// dropdown painted straight OVER both arrows — 19px at 320, 21px at 360/18px, 35px at 360/22px.
//
// That is the case this block exists for. An overflow assertion cannot see it: nothing leaves the
// viewport, the page does not scroll, every element is present and "visible", and the arrows are
// still hit-testable underneath. Only comparing the boxes to each other says anything is wrong.
// So this asserts SEPARATION, not containment — and on the rendered geometry, so any fix passes.
for (const [width, fontPx] of [[320, 14], [360, 14], [360, 18], [360, 22], [390, 14], [412, 20]]) {
    test(`calendar: the month arrows and the member select never overlap at ${width}px / ${fontPx}px text`, async ({ page }) => {
        await seedMember(page);
        await seedMemberSession(page);
        await page.setViewportSize({ width, height: 780 });
        await page.goto('/');
        await page.waitForSelector('#teamMemberSelect', { state: 'attached' });
        if (fontPx !== 14) {
            await page.addStyleTag({ content:
                `.controls select, .controls button { font-size: ${fontPx}px !important; }` });
        }
        await page.waitForTimeout(300);

        const geo = await page.evaluate((vw) => {
            const box = (sel) => {
                const r = document.querySelector(sel).getBoundingClientRect();
                return { left: r.left, right: r.right };
            };
            const sel = box('#teamMemberSelect');
            return {
                gapLeft:  sel.left - box('#prevMonth').right,
                gapRight: box('#nextMonth').left - sel.right,
                offscreen: [...document.querySelectorAll('.controls button, .controls select')]
                    .filter(e => { const r = e.getBoundingClientRect(); return r.left < -0.5 || r.right > vw + 0.5; })
                    .map(e => e.id || e.textContent.trim()),
                pageOverflow: document.documentElement.scrollWidth - vw,
            };
        }, width);

        expect(geo.offscreen, `cut off at ${width}px/${fontPx}px: ${geo.offscreen.join(', ')}`).toEqual([]);
        expect(geo.pageOverflow, `the page scrolls sideways at ${width}px/${fontPx}px`).toBeLessThanOrEqual(0);
        // A positive gap both sides. Zero would mean touching, negative means one is painted over
        // the other — which is what shipped, and what looks tappable while being covered.
        expect(geo.gapLeft, `the select overlaps ← Prev by ${-geo.gapLeft}px`).toBeGreaterThan(0);
        expect(geo.gapRight, `the select overlaps Next → by ${-geo.gapRight}px`).toBeGreaterThan(0);
    });
}

// ─── COMPACT UNDER TEXT SCALING (v22.87, owner decision) ─────────────────────────────────────────
// Android's text size scales every font and leaves the viewport alone, so at 412px the five-button
// row wrapped to 3 + 2 the moment its buttons reached 15px ("Largest"). The owner did not want two
// rows. text-scale.js measures the scale at boot and stamps <html>; the stylesheet tightens the row
// only then. A headless browser has no OS text size, so the scale is STATED through the test seam
// and the fonts scaled to match — the two halves of what a real phone does at once.
// Three things pinned: the default and "Large" rows are untouched (no stamp); at "Largest" and
// above the five stay on ONE line — 412px to 1.75×, 360px to 1.5× — with the icons gone and the
// words kept; and the wrap is still there beneath it all: at a scale compact cannot absorb, the
// row wraps 3 + 2 rather than clipping.
for (const [width, scale, expectRows] of [[412, 1.0, 1], [412, 1.15, 1], [412, 1.3, 1], [412, 1.5, 1], [412, 1.75, 1], [360, 1.3, 1], [360, 1.5, 1], [360, 2.0, 2]]) {
    test(`calendar: the action row at ${width}px under ${scale}× text is ${expectRows} row${expectRows > 1 ? 's' : ''}, nothing cut off`, async ({ page }) => {
        await seedMember(page);
        await seedMemberSession(page);
        await page.addInitScript((sc) => { const w = /** @type {any} */ (window); w.__E2E = Object.assign(w.__E2E || {}, { textScale: sc }); }, scale);
        await page.setViewportSize({ width, height: 820 });
        await page.goto('/');
        await page.waitForSelector('.control-group--actions');
        if (scale !== 1) {
            // Scale the fonts the way the OS would — the seam only tells the page what the scale IS.
            await page.addStyleTag({ content:
                `.controls select, .controls button { font-size: ${Math.round(12 * scale * 10) / 10}px !important; }` });
        }
        await page.waitForTimeout(300);
        const geo = await page.evaluate((vw) => {
            const btns = [...document.querySelectorAll('.control-group--actions button')];
            // Lines, not distinct rounded tops: `align-items: center` puts a shorter button a pixel
            // below a taller one on the SAME line, and an exact-top count read that as two rows.
            const lineCount = (els) => els.map(b => b.getBoundingClientRect().top).sort((a, b) => a - b)
                .reduce((lines, t) => (lines.length && t - lines[lines.length - 1] < 8 ? lines : lines.concat(t)), []).length;
            const rows = lineCount(btns);
            const cut = btns.filter(b => { const r = b.getBoundingClientRect(); return r.left < -0.5 || r.right > vw + 0.5; }).length;
            const pad = getComputedStyle(btns[1]).paddingLeft;
            const icons = [...document.querySelectorAll('.control-group--actions .btn-ico')];
            return { rows, cut, pad, stamp: document.documentElement.getAttribute('data-text-scale'),
                     iconsShown: icons.filter(i => i.getBoundingClientRect().width > 0).length,
                     // innerText, not textContent: a hidden icon span is still in textContent.
                     words: btns.slice(1).map(b => b.innerText.trim()) };
        }, width);
        expect(geo.cut, 'no button off the edge').toBe(0);
        expect(geo.rows, `expected ${expectRows} row(s), got ${geo.rows} (padding ${geo.pad}, stamp ${geo.stamp})`).toBe(expectRows);
        if (scale < 1.2) {
            expect(geo.stamp, 'below the threshold the action row is NOT compact (the heading tier may be stamped)').not.toBe('compact');
            expect(geo.pad, 'below the threshold the buttons keep their own padding, not the compact 8px').not.toBe('8px');
            expect(geo.iconsShown, 'below the threshold every icon is drawn').toBe(4);
        } else {
            expect(geo.stamp, 'at and above the threshold the page is stamped compact').toBe('compact');
            expect(geo.iconsShown, 'compact drops the four decorative icons').toBe(0);
            expect(geo.words, 'and keeps every word').toEqual(['Team', 'AL', 'Admin', 'Pay']);
            // The toggle rewrites the Team button; the icon must stay a hidden span through it.
            await page.locator('#teamViewBtn').click();
            await page.waitForSelector('.team-week-text');
            await page.waitForTimeout(300);   // the nav row hides and the actions row moves; measure after, not during
            const after = await page.evaluate(() => ({
                iconsShown: [...document.querySelectorAll('.control-group--actions .btn-ico')].filter(i => i.getBoundingClientRect().width > 0).length,
                word: document.getElementById('teamViewBtn').innerText.trim(),
                rows: [...document.querySelectorAll('.control-group--actions button')].map(b => b.getBoundingClientRect().top).sort((a, b) => a - b)
                    .reduce((lines, t) => (lines.length && t - lines[lines.length - 1] < 8 ? lines : lines.concat(t)), []).length,
            }));
            expect(after.iconsShown, 'after toggling to Team View the icons are still hidden').toBe(0);
            expect(after.word).toBe('Month');
            expect(after.rows, 'and the row is still as many lines as before').toBe(expectRows);
        }
    });
}

// ─── THE PAGE TITLE NEVER COVERS THE BURGER (whole-app review, 10 Nov 2026) ─────────────────────
// The title is centred on the page over the header, and Android's text size grows its words while
// the viewport stays put, so at 360px and 1.5× the logo covered the right half of ☰ — a tap there
// opened About instead of the menu — and at 2× the title ran off both edges. Its width is now capped
// at the room the burger leaves; where the cap binds the words take a second line. Three things
// pinned, measured: at the default size the title is ONE line at every phone width (the owner's
// compact header is unchanged); under scaling the logo stays clear of the burger and a tap on any
// part of the ☰ reaches the menu; and nothing runs off the screen.
for (const [width, scale] of [[320, 1.0], [360, 1.0], [412, 1.0], [320, 1.3], [360, 1.5], [393, 1.5], [360, 2.0], [412, 2.0]]) {
    test(`calendar: the page title stays clear of the burger at ${width}px under ${scale}× text`, async ({ page }) => {
        await seedMember(page);
        await seedMemberSession(page);
        await page.addInitScript((sc) => { const w = /** @type {any} */ (window); w.__E2E = Object.assign(w.__E2E || {}, { textScale: sc }); }, scale);
        await page.setViewportSize({ width, height: 800 });
        await page.goto('/');
        // A tap is answered once the splash has gone, a frame after the first render — which WebKit, busy, can
        // hold back past the grid's appearance: every tap below then landed on the splash (10 Nov 2026, CI).
        await expect(page.locator('#splash')).toHaveCount(0);
        await expect(page.locator('.calendar-day').first()).toBeVisible();
        // Every used font size × k, read before any is written so none compounds — what the OS does.
        if (scale !== 1) await scaleText(page, scale);
        const g = await page.evaluate(() => {
            const rect = (/** @type {string} */ s) => /** @type {Element} */ (document.querySelector(s)).getBoundingClientRect();
            const burger = rect('#navMenuBtn'), logo = rect('.title-icon'), h1 = rect('.header h1');
            // The words' own lines — the text node, not the h1, whose range would count the logo as one.
            const words = /** @type {Text} */ ([.../** @type {Element} */ (document.querySelector('.header h1')).childNodes]
                .find(n => n.nodeType === Node.TEXT_NODE && n.textContent?.trim()));
            const range = document.createRange();
            range.selectNodeContents(words);
            const lines = new Set([...range.getClientRects()].filter(r => r.width > 0).map(r => Math.round(r.top))).size;
            // A tap on each part of the ☰, as a thumb would land it.
            const taps = [0.25, 0.5, 0.75, 0.95].map(f => document.elementFromPoint(burger.left + burger.width * f,
                burger.top + burger.height / 2)?.closest('#navMenuBtn') ? 'menu' : 'not the menu');
            return { clear: logo.left - burger.right, taps, lines, left: h1.left, right: h1.right, vw: innerWidth };
        });
        expect(g.clear, `the logo stays clear of the burger (${g.clear.toFixed(1)}px)`).toBeGreaterThanOrEqual(2);
        expect(g.taps, 'every part of the ☰ opens the menu').toEqual(['menu', 'menu', 'menu', 'menu']);
        expect(g.left >= 0 && g.right <= g.vw, 'the title stays on the screen').toBe(true);
        if (scale === 1) expect(g.lines, 'at the default size the title is one line').toBe(1);
    });
}

/** Every finite animation and transition on the page run to its end — a wait, never a sleep. */
const settleMotion = (/** @type {import('@playwright/test').Page} */ page) => page.evaluate(() => Promise.all(
    document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => null))));

/** A colour token as this page computes it, for comparing with a computed fill. */
const resolvedColour = (/** @type {import('@playwright/test').Page} */ page, /** @type {string} */ name) => page.evaluate((n) => {
    const probe = document.body.appendChild(document.createElement('div'));
    probe.style.backgroundColor = `var(${n})`;
    const value = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return value;
}, name);

// ─── THE HEADER LOGO KEEPS STILL FOR A MEMBER WHO ASKED FOR LESS MOTION (whole-app fix, 10 Nov 2026) ─
// The logo opens About, and under a mouse it grows to 1.12× — decoration that exists to move. The
// sub-pages' logo stops for reduced motion (shared.css .app-icon); this one went on growing, on a
// 0.12s transition, exactly as it does for everybody else. The premise is measured first, so the
// test can see the grow it says is gone.
test('calendar: with reduced motion the header logo does not grow under the mouse', async ({ page }, info) => {
    test.skip(isTouchProject(info), 'a mouse');
    await page.setViewportSize({ width: 1366, height: 900 });
    await seedMember(page);
    await seedMemberSession(page);
    const hovered = async (/** @type {'reduce' | 'no-preference'} */ motion) => {
        await page.emulateMedia({ reducedMotion: motion });
        await page.goto('/');
        await expect(page.locator('.calendar-day').first()).toBeVisible();
        await page.locator('.title-icon').hover();
        await settleMotion(page);
        return page.locator('.title-icon').evaluate(el => ({
            transform: getComputedStyle(el).transform, duration: getComputedStyle(el).transitionDuration }));
    };
    expect((await hovered('no-preference')).transform, 'premise: for everybody else the logo grows').toBe('matrix(1.12, 0, 0, 1.12, 0, 0)');
    expect(await hovered('reduce'), 'no grow, and no transition to run one').toEqual({ transform: 'none', duration: '0s' });
});

// ─── A MONTH ARROW AT A BOUND OFFERS A MOUSE NOTHING (whole-app fix, 10 Nov 2026) ─────────────────
// At the last month the Calendar shows, Next is `aria-disabled` and faded (calendar-app.js) — never
// `disabled`, which drops a keyboard user's focus — and pressing it does nothing. It still offered
// the hand, the navy hover lift and the press, so to a mouse it looked like a way forward. Prev
// beside it keeps all three. The Today button's gold hover is read as well: the arrow is let out of
// the shared hover rule through :where(), because a plain second :not() raises that rule over
// Today's, Pay's and AL's own hover colours (measured: Today hovered navy).
test('calendar: a month arrow at the last month offers a mouse no hand, no hover lift and no press', async ({ page }, info) => {
    test.skip(isTouchProject(info), 'a mouse');
    await page.clock.setFixedTime(new Date(`${CONFIG.MAX_YEAR}-12-10T09:00:00Z`));
    await page.setViewportSize({ width: 1366, height: 900 });
    await seedMember(page);
    await seedMemberSession(page);
    await page.goto('/');
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    await expect(page.locator('#nextMonth'), 'premise: the last month has no next').toHaveAttribute('aria-disabled', 'true');
    const look = (/** @type {string} */ sel) => page.locator(sel).evaluate(el => {
        const cs = getComputedStyle(el);
        return { cursor: cs.cursor, fill: cs.backgroundColor, transform: cs.transform };
    });
    const hovered = async (/** @type {string} */ sel) => { await page.locator(sel).hover(); await settleMotion(page); return look(sel); };

    const live = await hovered('#prevMonth');
    expect(live, 'premise: a live arrow offers the hand, darkens and lifts under the mouse').toEqual({
        cursor: 'pointer', fill: await resolvedColour(page, '--primary-blue-dark'), transform: 'matrix(1, 0, 0, 1, 0, -1)' });

    expect(await hovered('#nextMonth'), 'the arrow at the bound, under the mouse').toEqual({
        cursor: 'default', fill: await resolvedColour(page, '--primary-blue'), transform: 'none' });
    await page.mouse.down();   // the mouse is over it: a press, held
    await settleMotion(page);
    const pressed = (await look('#nextMonth')).transform;
    await page.mouse.up();
    expect(pressed, 'a press does not squash it').toBe('none');

    expect((await hovered('.controls button.today-btn')).fill, 'Today keeps its own gold hover')
        .toBe(await resolvedColour(page, '--accent-gold-dark'));
});

// ─── THE LOADING SHAPE IS THE GRID'S SHAPE (whole-app fix, 10 Nov 2026) ───────────────────────────
// The boot skeleton exists so that nothing moves when the real grid replaces it, and says its sizes are
// the real grid's. Its corners were the desktop cell's 16px at every width, where a phone's cells and
// day heads are 6px. The real skeleton is mounted (calendar-lock-slot.js), over a drawn month.
for (const width of [390, 800]) {
    test(`calendar: the loading skeleton wears the real grid's corners at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await seedMember(page);
        await seedMemberSession(page);
        await page.goto('/');
        await expect(page.locator('.calendar-day').first()).toBeVisible();
        const corners = await page.evaluate(async () => {
            const radius = (/** @type {string} */ s) => getComputedStyle(/** @type {Element} */ (document.querySelector(s))).borderTopLeftRadius;
            const real = { cell: radius('.calendar-day:not(.other-month)'), head: radius('.day-header') };
            const { showBootSkeleton } = await import('./calendar-lock-slot.js');
            showBootSkeleton();
            return { real, boot: { cell: radius('.cal-boot-cell'), head: radius('.cal-boot-days span') } };
        });
        expect(corners.boot, `the skeleton's corners are the grid's (${JSON.stringify(corners.real)})`).toEqual(corners.real);
    });
}

// ─── WHILE DECEMBER LOADS, THE 25TH SHIMMERS WHOLE (whole-app fix, 10 Nov 2026) ────────────────────
// The loading shimmer and the Christmas tree are both a cell's ::after at equal specificity. The shimmer
// won but kept the tree's translateX(-50%), so on the 25th it swept half the cell, shifted off its left
// edge. The class the first load sets while its read is out (calendar-initial-fetch.js) is set by hand:
// the stubbed reads answer before a frame of it could be read.
test('calendar: while December loads, the 25th\'s shimmer covers its own cell', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.clock.setFixedTime(new Date('2026-12-10T09:00:00Z'));
    await seedMember(page);
    await seedMemberSession(page);
    await page.goto('/');
    await expect(page.locator('.calendar-day.christmas-day')).toBeVisible();
    expect(await page.locator('.calendar-day.christmas-day').evaluate(el => getComputedStyle(el, '::after').transform),
        'premise: the tree is centred by a transform').not.toBe('none');
    await page.evaluate(() => document.querySelector('#calendarDisplay .calendar-grid')?.classList.add('calendar-fetching'));
    expect(await page.locator('.calendar-fetching .calendar-day.christmas-day').evaluate(el => getComputedStyle(el, '::after').transform),
        'the shimmer is not moved by the tree\'s transform').toBe('none');
});

// ─── THE MONTH HEADING ROW IS ONE LINE, AND THE MONTH NAME NEVER SPLITS (v22.86 → v22.87) ────────
// A LINK THAT NAMES A DATE OPENS ITS MONTH, a future one included (whole-app review, Oct 2026). The
// Pay Calculator's "View these dates in your roster calendar" passed ?date= and nothing read it.
test('calendar: ?date= opens the month it names, once', async ({ page }) => {
    await seedMember(page);
    await seedMemberSession(page);
    await page.clock.setFixedTime(new Date('2026-09-03T10:00:00Z'));
    await page.goto('/?date=2026-12-14');
    await page.waitForSelector('.calendar-day');
    await expect(page.locator('.month-year').first()).toContainText('December');
    await expect(page, 'honoured once: the parameter comes off the address').not.toHaveURL(/date=/);
});

// "September 2026" is the longest heading the year produces. v22.86 stopped it splitting as
// "September / 2026▾" by wrapping the row — and on the owner's phone that put the week note on a
// second line where it had always shared the first. So the row is made cheaper instead (a smaller
// note, no dot, a tighter gap, and a smaller base under text scaling), and this pins the OUTCOME:
// one line at the default size from 360px up (a 320px phone has 294px for a 318px row, so there
// the note sits beneath even at the default), one line at "Large" on 360px and at "Largest" on
// 412px, and beyond that the note beneath the heading whole — never the heading split.
// Scaled the way a phone scales: the heading and the note together, and the tier stated through
// the seam, since a headless browser has no OS text size.
for (const [width, scale, oneLine] of [[320, 1.0, false], [360, 1.0, true], [390, 1.0, true], [412, 1.0, true],
                                       [360, 1.15, true], [412, 1.15, true], [412, 1.3, true],
                                       [360, 1.3, false], [412, 1.5, false]]) {
    test(`calendar: the month heading row at ${width}px under ${scale}× text is ${oneLine ? 'one line' : 'the note beneath'}, and the month never splits`, async ({ page }) => {
        await seedMember(page);
        await seedMemberSession(page);
        await page.clock.setFixedTime(new Date('2026-09-03T10:00:00Z'));
        await page.addInitScript((sc) => { const w = /** @type {any} */ (window); w.__E2E = Object.assign(w.__E2E || {}, { textScale: sc }); }, scale);
        await page.setViewportSize({ width, height: 820 });
        await page.goto('/');
        await page.waitForSelector('.calendar-day');
        if (scale !== 1) {
            // Scale what the stylesheet resolved (the tier is already stamped), as the OS would:
            // read each base size first, then set the scaled size explicitly.
            const base = await page.evaluate(() => ({
                h: parseFloat(getComputedStyle(/** @type {Element} */ (document.querySelector('.month-year'))).fontSize),
                n: parseFloat(getComputedStyle(/** @type {Element} */ (document.querySelector('.week-info'))).fontSize),
            }));
            await page.addStyleTag({ content:
                `.month-year { font-size: ${(base.h * scale).toFixed(2)}px !important; } .week-info { font-size: ${(base.n * scale).toFixed(2)}px !important; }` });
        }
        await page.waitForTimeout(250);
        const geo = await page.evaluate(() => {
            const h = document.querySelector('.month-year'), n = document.querySelector('.week-info');
            const rh = h.getBoundingClientRect(), rn = n.getBoundingClientRect();
            const fs = parseFloat(getComputedStyle(h).fontSize);
            return { headingLines: rh.height / (fs * 1.3), sameLine: Math.abs(rn.top - rh.top) < rh.height * 0.6 && rn.left >= rh.right - 1,
                     beneath: rn.top >= rh.bottom - 1, noteLines: rn.height / (parseFloat(getComputedStyle(n).fontSize) * 1.3),
                     headingPx: fs, dot: getComputedStyle(n.firstElementChild || n, '::before').content };
        });
        expect(geo.headingLines, `the month name split (${geo.headingLines.toFixed(2)} lines at ${geo.headingPx}px)`).toBeLessThan(1.5);
        expect(geo.noteLines, 'the note never breaks mid-phrase').toBeLessThan(1.5);
        expect(geo.dot === 'none' || geo.dot === 'normal', 'no separator dot').toBe(true);
        if (oneLine) expect(geo.sameLine, 'the note shares the heading\'s line').toBe(true);
        else expect(geo.beneath, 'past what the row can hold, the note sits beneath the heading, whole').toBe(true);
    });
}

// ─── THE WEEK ROW: THE DATE, THEN THE WORDS (v22.85 → v22.88) ───────────────────────────────────
// v22.85 said the current week with a gold rule under the date and put the way back in a glyph-only
// ↩ beside the grade tabs — tidy, and two things a colleague had to decode. Reversed on review: the
// centre is now a designed two-line stack on EVERY week — the date, then "This week" (a state) or
// "↩ Back to this week" (an action) — with the arrows aligned to the date line, so nothing floats
// and nothing moves between weeks. Pinned: both lines present in both states, the second beneath the
// first, the action only while away and it works, the date line level with the arrows, and the
// words themselves — because the words are the point.
for (const [width, scale] of [[320, 1.0], [412, 1.3], [412, 1.6], [1280, 1.0]]) {
    test(`calendar: the team week row is the date over its words, arrows level with the date, at ${width}px / ${scale}× text`, async ({ page }) => {
        await seedMember(page);
        await seedMemberSession(page);
        await page.clock.setFixedTime(new Date('2026-09-03T10:00:00Z'));   // a cross-month week: the longest label
        await page.setViewportSize({ width, height: 820 });
        await page.goto('/');
        await page.waitForSelector('.control-group--actions', { state: 'attached' });
        await page.locator('#teamViewBtn').click();
        await page.waitForSelector('.team-week-text');
        if (scale !== 1) {
            // Scale the way the OS does — every size by the same factor — so the date line's em-based
            // height and the arrows' font-based height move together, as they do on a phone.
            const base = await page.evaluate(() => Object.fromEntries(['.team-week-text', '.tv-week-nav', '.tv-week-status', '.grade-tab']
                .map(sel => [sel, parseFloat(getComputedStyle(/** @type {Element} */ (document.querySelector(sel))).fontSize)])));
            await page.addStyleTag({ content: Object.entries(base).map(([sel, px]) => `${sel} { font-size: ${(px * scale).toFixed(2)}px !important; }`).join(' ') });
        }
        await page.waitForTimeout(300);

        const state = () => page.evaluate(() => {
            const r = (el) => el.getBoundingClientRect();
            const label = /** @type {HTMLElement} */ (document.querySelector('.team-week-text'));
            const status = /** @type {HTMLElement|null} */ (document.querySelector('.tv-week-status'));
            const prev = r(document.querySelector('#tvPrevWeek'));
            const lb = r(label);
            return {
                words: status ? status.innerText.trim() : null,
                isButton: status ? status.tagName === 'BUTTON' && status.id === 'tvToday' : null,
                beneath: status ? r(status).top >= lb.bottom - 1 : null,
                // The date line is level with the arrows: the arrow box sits inside the label's first line box.
                level: prev.top >= lb.top - 1 && prev.bottom <= lb.top + lb.height + 1,
                jumpBesideTabs: !!document.querySelector('.grade-tabs-row #tvToday'),
            };
        });

        const here = await state();
        expect(here.words, 'on the current week the second line says so').toBe('This week');
        expect(here.isButton, 'and it is a statement, not a control').toBe(false);
        expect(here.beneath, 'the words sit beneath the date').toBe(true);
        expect(here.level, 'the arrows are level with the date line').toBe(true);
        expect(here.jumpBesideTabs, 'nothing beside the grade tabs').toBe(false);

        await page.locator('#tvNextWeek').click();
        await page.waitForTimeout(300);
        const away = await state();
        expect(away.words, 'browsing away, the second line is the way back, in words').toBe('↩ Back to this week');
        expect(away.isButton, 'and it is a real button').toBe(true);
        expect(away.beneath).toBe(true);
        expect(away.level).toBe(true);
        await expect.poll(() => page.locator('#ariaAnnouncer').textContent()).toMatch(/^Week of \d/);
        expect(await page.locator('#ariaAnnouncer').textContent()).not.toMatch(/this week/);

        await page.locator('#tvToday').click();
        await page.waitForTimeout(300);
        expect((await state()).words, 'the words bring you back').toBe('This week');
        await expect.poll(() => page.locator('#ariaAnnouncer').textContent()).toMatch(/this week/);
    });
}

// The five action buttons on a phone NARROWER than the app's 360px design width. Android's
// "Display size" setting shrinks the CSS viewport where the separate font-size setting does not, so
// an older Samsung on a larger one reports ~320-333px — and at the DEFAULT text size the row needed
// 319px against 294px and wrapped to two. Text scale could never have caught it: this is the other
// axis. Measured plain, no seam and no font simulation.
for (const width of [320, 333, 360]) {
    test(`calendar: the action row is one line at ${width}px with no text scaling`, async ({ page }) => {
        await seedMember(page);
        await seedMemberSession(page);
        await page.setViewportSize({ width, height: 820 });
        await page.goto('/');
        await page.waitForSelector('.control-group--actions button');
        await page.waitForTimeout(250);
        const geo = await page.evaluate((vw) => {
            const btns = [...document.querySelectorAll('.control-group--actions button')];
            const lines = btns.map(b => b.getBoundingClientRect().top).sort((a, b) => a - b)
                .reduce((L, t) => (L.length && t - L[L.length - 1] < 8 ? L : L.concat(t)), []).length;
            return { lines, cut: btns.filter(b => { const q = b.getBoundingClientRect();
                        return q.left < -0.5 || q.right > vw + 0.5; }).length,
                     stamp: document.documentElement.getAttribute('data-text-scale'),
                     icons: [...document.querySelectorAll('.control-group--actions .btn-ico')]
                        .filter(i => i.getBoundingClientRect().width > 0).length,
                     // innerText, not textContent: a hidden icon span is still in textContent.
                     // The leading emoji is stripped so one assertion covers both sides of the
                     // breakpoint — the WORD is what must survive, with or without its icon.
                     words: btns.slice(1).map(b => b.innerText.replace(/^[^A-Za-z]+/, '').trim()) };
        }, width);
        expect(geo.stamp, 'no text scaling here — this is purely a width case').toBeNull();
        expect(geo.cut, 'no button off the edge').toBe(0);
        expect(geo.lines, `expected one line at ${width}px, got ${geo.lines}`).toBe(1);
        expect(geo.words, 'the WORDS are the content and never go, at any width')
            .toEqual(['Team', 'AL', 'Admin', 'Pay']);
        // Below the design width the four decorative icons are what pays for the single line;
        // at 360 and above they stay.
        expect(geo.icons, width < 360 ? 'icons drop below 360px' : 'icons stay from 360px')
            .toBe(width < 360 ? 0 : 4);
    });
}

// A corner marker's cell pads its date off the marker's side (index.css, ≤480px; polish review, 26 Nov 2026). On a
// 320px phone at 1.6× text (measured: a 40px cell, a 25px "20") the cell is narrower than the date and a fixed 12px pad together, and the cell's
// `overflow: hidden` clipped the last digit — so the pad gives way first. Nothing but a browser can see a clipped digit.
for (const k of [1, 1.3, 1.6]) {
    test(`calendar: a date beside a payday or cut-off marker is never clipped at 320px (${k}× text)`, async ({ page }) => {
        await page.clock.setFixedTime(new Date('2026-11-16T09:00:00Z'));   // November 2026: a payday and a cut-off
        await page.setViewportSize({ width: 320, height: 700 });
        await page.goto('/');
        await expect(page.locator('.calendar-day.payday').first()).toBeVisible();
        if (k !== 1) await scaleText(page, k);
        const clipped = await page.evaluate(() => [...document.querySelectorAll(
            '.calendar-day.payday .day-number, .calendar-day.cutoff .day-number, .calendar-day.bank-holiday .day-number')]
            .map(el => {
                const cell = /** @type {HTMLElement} */ (el.closest('.calendar-day')).getBoundingClientRect();
                const range = document.createRange();
                range.selectNodeContents(el);
                const text = range.getBoundingClientRect();
                return { date: el.textContent, out: Math.max(cell.left - text.left, text.right - cell.right) };
            })
            .filter(d => d.out > 0.5));
        expect(clipped, 'a date runs past its cell').toEqual([]);
    });
}

// THE WEEK NOTE'S LONGEST FORM SHARES THE MONTH'S LINE (owner, 26 Nov 2026). A month that crosses the end of the
// cycle reads "CEA Weeks 19–20, 1–3", and on the owner's phone "November 2026" and that note missed one line by a
// pixel, so the note dropped beneath the heading where December's sat beside it. A thin space after the comma and a
// 4px gap gave it room. Measured with the widest month name and the longest note, at 375px, with room to spare —
// "it fits" alone passed by 0.8px before the fix, so the test asks for a margin (calendar-renderer.js, index.css).
test('calendar: the longest week note shares the widest month name\'s line at 375px, with room to spare', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto('/');
    await expect(page.locator('.calendar-header .week-info-text').first()).toBeVisible();
    const r = await page.evaluate(() => {
        const h = /** @type {HTMLElement} */ (document.querySelector('.calendar-header'));
        const m = /** @type {HTMLElement} */ (h.querySelector('.month-year'));
        const n = /** @type {HTMLElement} */ (h.querySelector('.week-info-text'));
        m.textContent = 'September 2026';
        n.textContent = 'CEA Weeks 19–20,\u20091–3';
        const cs = getComputedStyle(h);
        const inner = h.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
        const mb = m.getBoundingClientRect(), nb = /** @type {HTMLElement} */ (n.parentElement).getBoundingClientRect();
        // One line: the note starts above the month's foot (the two sit on one baseline at different sizes, so their
        // tops differ). The slack is the row's width less the line's span, from the month's left to the note's right.
        return { slack: inner - (nb.right - mb.left), sameLine: nb.top < mb.bottom };
    });
    expect(r.sameLine, 'the note dropped beneath the month').toBe(true);
    expect(r.slack, 'it fits by a hair: a phone a pixel narrower, or a little larger text, drops it').toBeGreaterThanOrEqual(3);
});
