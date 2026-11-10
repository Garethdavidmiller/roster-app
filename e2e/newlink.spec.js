// @ts-check
/**
 * newlink.spec.js — the new link page (newlink.html): the three shortlisted proposals, presented evenly, to every colleague
 * on a normal CEA contract and the managers (open since v25.60; before that, the admin's and S. Silva's preview).
 *
 * What only a browser can show: that the page REACHES its audience and turns everybody else away, that the two choices on it
 * redraw what they say they do, and that a proposal's weeks are drawn as a proposal. The words and figures themselves
 * are pinned in Node (newlink-render.test.mjs, newlink-data.test.mjs); this drives the real page through them.
 */
import { test, expect, withLinksDesigners } from './fixtures.js';
import { collectFatalErrors, seedSession } from './helpers.js';
import { CHANGES, PACK } from '../newlink-data.js';
import { CONFIG, teamMembers } from '../roster-data.js';

/**
 * Somebody on the roster who fits, found rather than named so a leaver cannot break a test, and never the admin or a named
 * previewer, who reach the page by their own lists. @param {string} what @param {(m: any) => boolean} fits @returns {string}
 */
function someone(what, fits) {
    const m = teamMembers.find(x => !x.hidden && !CONFIG.ADMIN_NAMES.includes(x.name) && !CONFIG.NEWLINK_PREVIEW.includes(x.name) && fits(x));
    if (!m) throw new Error(`the roster has no ${what}`);
    return m.name;
}

test.describe('new link', () => {
    test('the admin sees the page, the three proposals A to Z, and no recommendation anywhere', async ({ page }) => {
        const errors = collectFatalErrors(page);
        await seedSession(page, 'G. Miller');
        await page.goto('/newlink.html');

        // NO PREVIEW BANNER (owner, 8 Nov 2026: "Remove the preview banner as it will be going live soon"): the admin sees
        // exactly what colleagues do. Who it reaches is auth-policy.js → `newlinkAudience`, held to the roster in Node
        await expect(page.locator('.nl-name-title').first()).toBeVisible();
        await expect(page.locator('#nlPreview, .nl-preview')).toHaveCount(0);
        await expect(page.locator('body')).not.toContainText(/Preview —|Who it would reach/);
        await expect(page.locator('.nl-name-title')).toHaveText(['Balanced V6', 'Level Crossing', 'Middle Ground']);
        await expect(page.locator('#nlStatus')).toContainText('Have your say by a date to be agreed');
        // EVENLY: nothing on the page names a recommendation (owner, 2 Nov 2026: "No, three evenly")
        await expect(page.locator('main')).not.toContainText(/recommend/i);
        // what has changed since Short Run was shown, and what all three share — gains AND costs
        await expect(page.locator('#nlChangesList li')).toHaveCount(CHANGES.length);   // every line the data holds, however many
        await expect(page.locator('.nl-side--gain li').first()).toBeVisible();
        await expect(page.locator('.nl-side--cost li').first()).toBeVisible();
        expect(errors).toEqual([]);
    });

    // The page passes TODAY to the status line (test audit, 7 Nov 2026). The tenses are renderStatus's unit tests; what only
    // a browser can show is that the page hands it the real date — before this it had no date logic at all, and once the
    // link's start had come it would still have said the link "starts on" it.
    for (const [day, says, never] of /** @type {[string, RegExp|null, RegExp][]} */ ([
        ['2026-12-20T09:00:00Z', /The new link starts in January\s2027, and today’s link carries on until then\. The new timetable started in December\./, /comes first/],
        ['2027-01-04T09:00:00Z', null, /starts (on|in)|carries on until then/],
    ])) {
        test(`the status line on ${day.slice(0, 10)} speaks of the dates as they then are`, async ({ page }) => {
            await page.clock.setFixedTime(new Date(day));
            await seedSession(page, 'G. Miller');
            await page.goto('/newlink.html');
            const status = page.locator('#nlStatus');
            await expect(status).toContainText('Nothing is decided.');
            if (says) await expect(status).toContainText(says);
            await expect(status).not.toContainText(never);
        });
    }

    // AN INSTALLED APP IS NOT RELOADED WHEN IT IS REOPENED (iPhone audit, Nov 2026): iOS keeps it resident for days, and
    // the status was worked out once, at load. It is drawn again whenever the page comes back — and only when the day
    // has moved, so a tile holding focus on a same-day return keeps it.
    test('the status line is drawn again when the page comes back on a later day', async ({ page }) => {
        const setVisibility = (/** @type {'hidden'|'visible'} */ state) => page.evaluate((s) => {
            Object.defineProperty(document, 'visibilityState', { value: s, configurable: true });
            document.dispatchEvent(new Event('visibilitychange'));
        }, state);
        await page.clock.setFixedTime(new Date('2026-12-20T09:00:00Z'));
        await seedSession(page, 'G. Miller');
        await page.goto('/newlink.html');
        const status = page.locator('#nlStatus');
        await expect(status).toContainText('today’s link carries on until then. The new timetable started in December.');

        // The same day: nothing is redrawn, so the tile with focus still has it.
        await status.locator('.nl-name').first().focus();
        await setVisibility('hidden');
        await page.clock.setFixedTime(new Date('2026-12-20T11:00:00Z'));
        await setVisibility('visible');
        await expect(status.locator('.nl-name').first()).toBeFocused();

        // A fortnight later, the link has started: the sentence about it goes.
        await setVisibility('hidden');
        await page.clock.setFixedTime(new Date('2027-01-04T09:00:00Z'));
        await setVisibility('visible');
        await expect(status).not.toContainText(/starts (on|in)|carries on until then/);
        await expect(status).toContainText('Nothing is decided.');
        await expect(status.locator('.nl-name'), 'the tiles are drawn again, and still open their weeks').toHaveCount(3);
        await status.locator('.nl-name').first().click();
        await expect(page.locator('#nlWeeksStatus')).toContainText('Showing Balanced V6’s');
    });

    test('choosing a way of working shows its sentence and figures; Everything shows all six; pressing again goes back', async ({ page }) => {
        await seedSession(page, 'G. Miller');
        await page.goto('/newlink.html');

        const panel = page.locator('#nlPersonaPanel');
        // nothing chosen: the six one-line answers
        await expect(panel.locator('.nl-gists li')).toHaveCount(6);

        const earlies = page.locator('[data-persona="earlies"]');
        await earlies.click();
        await expect(earlies).toHaveAttribute('aria-pressed', 'true');
        await expect(earlies).toBeFocused();   // the redraw keeps focus on the pressed tile
        await expect(panel.locator('.nl-persona')).toHaveCount(1);
        await expect(panel.locator('.nl-persona-h')).toHaveText(/If you prefer earlies/);
        await expect(panel.locator('thead th')).toHaveText(['Today', 'Balanced V6', 'Level Crossing', 'Middle Ground']);
        await expect(panel.locator('.nl-best').first()).toBeVisible();

        await page.locator('[data-persona="all"]').click();
        await expect(panel.locator('.nl-persona')).toHaveCount(6);
        await expect(earlies).toHaveAttribute('aria-pressed', 'false');

        await page.locator('[data-persona="all"]').click();
        await expect(panel.locator('.nl-gists li')).toHaveCount(6);

        // and a way back that says where it goes, landing on the tile that was chosen
        await earlies.click();
        await page.locator('[data-persona-reset]').click();
        await expect(panel.locator('.nl-gists li')).toHaveCount(6);
        await expect(earlies).toHaveAttribute('aria-pressed', 'false');
        await expect(earlies).toBeFocused();
    });

    test('the weeks are drawn as a proposal, 26 to a design: one at a time on a phone, all three side by side when wide', async ({ page }) => {
        await seedSession(page, 'G. Miller');
        await page.goto('/newlink.html');

        const weeks = page.locator('#nlWeeksPanel');
        await expect(weeks.locator('.nl-weeks-one')).toHaveCount(3);
        const chosen = weeks.locator('.nl-weeks-one.is-chosen');
        await expect(chosen.locator('.nl-flag')).toHaveText(/A proposal — not your roster/);
        // the first A to Z, never the recommendation — the page presents the three evenly
        await expect(chosen.locator('caption')).toContainText('Balanced V6');
        await expect(chosen.locator('tbody tr')).toHaveCount(26);
        await expect(chosen.locator('tbody tr.nl-wk-cover')).toHaveCount(5);
        // numbered, never dated
        await expect(chosen.locator('tbody th').first()).toHaveText('1');
        // the key comes before the weeks, and says Sunday is overtime
        await expect(page.locator('#nlWeeksKey')).toContainText('Sunday shifts are overtime');
        const keyBox = await page.locator('#nlWeeksKey').boundingBox();
        const panelBox = await weeks.boundingBox();
        expect(keyBox && panelBox && keyBox.y < panelBox.y).toBe(true);
        // each swatch wears its cells' edge — a `border` shorthand after the kind's colour once reset it to the text colour
        for (const kind of ['early', 'late']) {
            const edge = (/** @type {string} */ sel) => page.locator(sel).first().evaluate(n => getComputedStyle(n).borderTopColor);
            expect(await edge(`#nlWeeksKey .nl-swatch.nl-d--${kind}`), kind).toBe(await edge(`#nlWeeksPanel .is-chosen td.nl-d--${kind}`));
        }

        if ((page.viewportSize()?.width ?? 0) >= 1024) {
            // WIDE: the three side by side, no tabs — no proposal gets the first look
            await expect(page.locator('#nlWeeksTabs')).toBeHidden();
            const boxes = await Promise.all((await weeks.locator('.nl-weeks-one').all()).map(b => b.boundingBox()));
            expect(boxes.every(b => b && Math.abs(b.y - /** @type {any} */ (boxes[0]).y) < 2)).toBe(true);
            expect(boxes.map(b => b?.x)).toEqual([...boxes.map(b => b?.x)].sort((a, b) => (a ?? 0) - (b ?? 0)));
            // THE LEFT-HAND GRID IS BALANCED V6 (owner, 8 Nov 2026: "make the balanced v5 option as the left hand grid on
            // desktop. I must not be seen to be favouring my designs over Sara's"). A to Z puts it there; this keeps it there
            const grids = await Promise.all((await weeks.locator('.nl-weeks-one').all())
                .map(async g => ({ x: (await g.boundingBox())?.x ?? 0, name: await g.locator('caption').innerText() })));
            expect(grids.sort((a, b) => a.x - b.x)[0].name).toContain('Balanced V6');
            return;
        }
        // A PHONE: the chosen one only, under tabs that change it
        await expect(weeks.locator('.nl-weeks-one:not(.is-chosen)').first()).toBeHidden();
        await page.locator('[data-design="proposal:LC-26-T10"]').click();
        await expect(page.locator('[data-design="proposal:LC-26-T10"]')).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('[data-design="proposal:LC-26-T10"]')).toBeFocused();
        await expect(chosen.locator('caption')).toContainText('Level Crossing');
        await expect(chosen.locator('tbody tr')).toHaveCount(26);
        // ...and the tabs stay in reach while the weeks scroll beneath them (a card with `overflow: hidden` would let
        // them scroll away — the cascade decides this, so only a browser can see it)
        await chosen.locator('tbody tr').nth(18).scrollIntoViewIfNeeded();
        await page.evaluate(() => window.scrollBy(0, 200));
        const tabs = await page.locator('#nlWeeksTabs').boundingBox();
        expect(tabs && tabs.y >= -1 && tabs.y < 4).toBe(true);
    });

    test('a label that wraps does not knock its tile out of line: the names share a foot, the seven icons a line', async ({ page }) => {
        // Desktop audit, Nov 2026: "Common Ground" wraps at every desktop width, so its "See its weeks" sat 18px lower than
        // its neighbours'; at 1024 "Swap for overtime" wraps, and its emoji rose above the other six.
        await seedSession(page, 'G. Miller');
        for (const width of [1024, 1366]) {
            await page.setViewportSize({ width, height: 900 });
            await page.goto('/newlink.html');
            await expect(page.locator('.nl-name-title')).toHaveCount(3);
            const feet = await page.locator('.nl-name-go').evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().bottom)));
            expect(new Set(feet).size, `at ${width}px the three "See its weeks" sit on one line: ${feet}`).toBe(1);
            const icons = await page.locator('.nl-tile-icon').evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().top)));
            expect(icons.length, 'the seven ways of working').toBe(7);
            expect(new Set(icons).size, `at ${width}px the seven icons share one line: ${icons}`).toBe(1);
        }
    });

    // A FIGURE NEVER RUNS INTO THE NEXT COLUMN (bug check, 9 Nov 2026). "£140 more" is held together by a no-break space, so
    // at 320px — or on a phone with its text made larger, which multiplies every size and leaves the width alone — it could
    // not wrap, and ran 7px into "£130 more". Since figureText (newlink-render.js) each held run is one inline-block that
    // takes a line of its own, whole, and wraps inside itself only when even that line is too narrow.
    // NOR DOES ANYTHING ELSE (the large-text check, 9 Nov 2026; owner: "OK"). At 1.3 times the text a figure heading
    // ("BALANCED") was wider than its column, and a time in the 26 weeks wider than its day, both running into the next; at
    // 320px the pack's rows were cut off at the card's edge. The headings now break at soft hyphens, the 26 weeks scroll
    // sideways inside their frame — and only there: the page itself never does — and the pack's rows give way.
    // Each half is pinned: nothing leaves its cell, its card or the screen at 320px, or at 1.3 times the text from 320px to
    // 375px; at 375px at the normal size, where everything fits, no held run is split and the 26 weeks do not scroll.
    // The text is enlarged ONCE per element, as Android does: helpers.js's scaleText reads each size after its parent has
    // been enlarged, so inherited text is multiplied again at every level (14px became 49px at 1.15 on this page).
    test('a phone\'s larger text runs nothing into its neighbour or off the screen, and the 26 weeks scroll rather than overlap', async ({ page }) => {
        await seedSession(page, 'G. Miller');
        const open = async (/** @type {number} */ width) => {
            await page.setViewportSize({ width, height: 900 });
            await page.goto('/newlink.html');
            await expect(page.locator('.nl-name-title')).toHaveCount(3);
            await page.locator('[data-persona="all"]').click();
            await expect(page.locator('#nlPersonaPanel .nl-persona')).toHaveCount(6);
            await expect(page.locator('#nlWeeksPanel .is-chosen .nl-weeks tbody tr')).toHaveCount(26);
        };
        const scaleOnce = (/** @type {number} */ k) => page.evaluate(m => {
            const els = [...document.querySelectorAll('*')], px = els.map(e => parseFloat(getComputedStyle(e).fontSize));
            els.forEach((e, i) => { if (px[i]) /** @type {HTMLElement} */ (e).style.fontSize = `${px[i] * m}px`; });
        }, k);
        // every table cell on the page: the figures and their headings, and the chosen proposal's 26 weeks
        const CELLS = '#nlPersonaPanel .nl-fig td, #nlPersonaPanel .nl-fig th, #nlWeeksPanel .is-chosen .nl-weeks td, #nlWeeksPanel .is-chosen .nl-weeks th';
        const spills = () => page.locator(CELLS).evaluateAll(cells => cells.flatMap(cell => {
            const rects = [], walk = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
            for (let n = walk.nextNode(); n; n = walk.nextNode()) {
                if (!n.textContent?.trim() || n.parentElement?.closest('.visually-hidden')) continue;
                const r = document.createRange(); r.selectNodeContents(n); rects.push(...r.getClientRects());
            }
            const box = cell.getBoundingClientRect();
            const out = Math.max(0, ...rects.map(r => Math.max(box.left - r.left, r.right - box.right)));
            return out > 1 ? [`"${cell.textContent?.trim()}" leaves its cell by ${out.toFixed(1)}px`] : [];
        }));
        // anything wider than its card is cut off by the card's clip, silently; the 26 weeks are the one thing allowed to
        // be wider, inside their own scrolling frame
        const offCard = () => page.evaluate(() => [...document.querySelectorAll('main .card')].flatMap(card => {
            const c = card.getBoundingClientRect();
            const out = [...card.querySelectorAll('*')].filter(e => e.getClientRects().length && !e.closest('.visually-hidden')
                && !(e.closest('.nl-weeks-wrap') && !e.matches('.nl-weeks-wrap'))
                && (e.getBoundingClientRect().right - c.right > 0.5 || c.left - e.getBoundingClientRect().left > 0.5));
            return out.slice(0, 1).map(e => `#${card.id}: "${e.textContent?.trim().slice(0, 40)}" runs off the card`);
        }));
        const pageScroll = () => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
        const weeksScroll = () => page.locator('#nlWeeksPanel .is-chosen .nl-weeks-wrap').evaluate(w => w.scrollWidth - w.clientWidth);
        for (const [width, k] of [[320, 1], [320, 1.3], [360, 1.3], [375, 1.3]]) {
            await open(width);
            if (k !== 1) await scaleOnce(k);
            const at = `at ${width}px${k === 1 ? '' : ` with the text ${k} times larger`}`;
            expect(await spills(), `${at}: nothing leaves its cell`).toEqual([]);
            expect(await offCard(), `${at}: nothing is cut off at a card's edge`).toEqual([]);
            expect(await pageScroll(), `${at}: the page itself never scrolls sideways`).toBe(0);
        }
        expect(await weeksScroll(), 'premise: at 375px and 1.3 times the text, the 26 weeks are wider than the screen').toBeGreaterThan(0);
        // …and their frame truly scrolls: a frame that merely overflowed would be cut off at the card, Saturday out of reach
        expect(await page.locator('#nlWeeksPanel .is-chosen .nl-weeks-wrap').evaluate(w => { w.scrollLeft = 1e6; return w.scrollLeft; }),
            'the frame scrolls to its last day').toBeGreaterThan(0);
        await open(375);
        expect(await weeksScroll(), 'at 375px at the normal size the 26 weeks fit, so nothing moved').toBe(0);
        const runs = page.locator('#nlPersonaPanel .nl-nb');
        expect(await runs.count(), 'premise: the figures hold runs of words together').toBeGreaterThan(10);
        expect(await runs.evaluateAll(els => els.filter(e => e.getClientRects().length > 1).map(e => e.textContent)),
            'at 375px every held run fits on one line, so none is split').toEqual([]);
    });

    // A SCROLLING FRAME A KEYBOARD CAN REACH (axe scrollable-region-focusable, as Team View's week table): when the 26 weeks
    // are too wide for the screen, Tab reaches the frame and the arrow keys scroll it. It is named for its proposal.
    test('the 26 weeks\' frame is a named tab stop, so a keyboard can scroll it', async ({ page }) => {
        await seedSession(page, 'G. Miller');
        await page.goto('/newlink.html');
        const frame = page.locator('#nlWeeksPanel .is-chosen .nl-weeks-wrap');
        await expect(frame).toHaveAttribute('tabindex', '0');
        await expect(frame).toHaveAttribute('role', 'group');
        await expect(frame).toHaveAttribute('aria-label', /^Balanced V6’s 26 weeks$/);
    });

    // ── THE PACK OPENS ON THE PAGE, IN THE APP'S PDF VIEWER (owner, 10 Nov 2026) ─────────────────────────────────────
    // "The pdfs on the new links page don't have a close button like the huddle pdf does. This is particularly an issue on
    // iphone": an app installed from the github.io address opened them in its own window, where an iPhone has no way back.
    // They now open in pdf-viewer.js — drawn by the vendored PDF.js, in a panel with a ✕. The files are served here from
    // the repository itself (the real PDFs), so the test needs no network and reads exactly what the mirror serves.
    const MIRROR_PACK = 'https://garethdavidmiller.github.io/roster-app/docs/links-26/';
    /** Serve the pack's address from the repository; `answer` may replace a file's response. @param {import('@playwright/test').Page} page */
    async function servePack(page, answer = /** @type {null|((route: import('@playwright/test').Route) => Promise<void>)} */ (null)) {
        await page.route(`${MIRROR_PACK}**`, async (route) => {
            if (answer) return answer(route);
            const path = decodeURIComponent(new URL(route.request().url()).pathname.replace('/roster-app/', ''));
            return route.fulfill({ path, contentType: 'application/pdf', headers: { 'access-control-allow-origin': '*' } });
        });
    }
    /**
     * Console errors — a CSP refusal (eval, a worker, the fetch) is logged there, not thrown. The page's own Firebase reads
     * are left out: with no emulator behind them they answer 404 here (the member's password status), nothing to do with
     * the viewer. @param {import('@playwright/test').Page} page
     */
    function consoleErrors(page) {
        /** @type {string[]} */ const errs = [];
        page.on('console', m => {
            const where = m.location()?.url ?? '';
            if (m.type() === 'error' && !/\.googleapis\.com\//.test(where)) errs.push(`${m.text()} — ${where}`);
        });
        return errs;
    }
    /** Is the canvas drawn — not blank white? Reads its pixels. @param {import('@playwright/test').Locator} canvas */
    const inked = (canvas) => canvas.evaluate((/** @type {HTMLCanvasElement} */ c) => {
        const d = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d')).getImageData(0, 0, c.width, c.height).data;
        let dark = 0;
        for (let i = 0; i < d.length; i += 16) if (d[i] + d[i + 1] + d[i + 2] < 600) dark++;
        return dark;
    });

    test('the pack: every file is listed, a real link to where docs/ is served', async ({ page }) => {
        await seedSession(page, 'G. Miller');
        await page.goto('/newlink.html');
        const links = page.locator('#nlPackList a.nl-file');
        await expect(links).toHaveCount(PACK.length);   // what the generated data lists — since 8 Nov 2026 each shortlisted link's presentation and proposal sheet, and the rules
        for (const a of await links.all()) {
            // Still a real link, so a Ctrl- or middle-click gives a desktop reader a tab of its own.
            await expect(a).toHaveAttribute('href', /^https:\/\/garethdavidmiller\.github\.io\/roster-app\/docs\/links-26\/.+\.pdf$/);
            await expect(a).toHaveAttribute('aria-haspopup', 'dialog');
        }
        await expect(page.locator('#nlPackList')).toContainText('The files open on this page, and need a connection.');
    });

    test('a pack file opens ON THE PAGE, drawn, with a ✕ that comes back — no tab, no leaving the app', async ({ page, context }) => {
        const errors = collectFatalErrors(page);
        const logged = consoleErrors(page);
        await servePack(page);
        await seedSession(page, 'G. Miller');
        await page.goto('/newlink.html');
        const file = PACK.find(f => f.design && f.pages > 1) ?? PACK[0];
        const link = page.locator(`#nlPackList a.nl-file[data-file="${file.path}"]`);
        // From the KEYBOARD: Enter on the link is the click a keyboard user makes, and it leaves focus on the link in
        // every engine (WebKit does not focus a link on a mouse click), so the ✕ has somewhere to send it back to.
        await link.focus();
        await page.keyboard.press('Enter');

        const viewer = page.locator('#pdfViewer');
        await expect(viewer).toHaveClass(/\bopen\b/);
        expect(context.pages(), 'the file opened here, not in a tab of its own').toHaveLength(1);
        expect(new URL(page.url()).pathname, 'and the page under it stayed where it was').toBe('/newlink.html');
        await expect(page.locator('#pdfViewerTitle')).toHaveText(file.label);
        await expect(page.locator('#pdfViewerMeta')).toHaveText(`${file.design} · PDF · ${file.pages} pages`);
        await expect(viewer).toHaveAttribute('role', 'dialog');

        // EVERY PAGE has its box, named for a screen reader; the first is DRAWN — real ink, not a white rectangle.
        const pages = page.locator('#pdfViewerSheet .pdf-viewer-page');
        await expect(pages).toHaveCount(file.pages);
        await expect(pages.first()).toHaveAttribute('aria-label', `Page 1 of ${file.pages}`);
        const first = pages.first().locator('canvas');
        await expect(first).toHaveCount(1, { timeout: 20_000 });
        expect(await inked(first), 'the first page has something drawn on it').toBeGreaterThan(200);
        await expect(page.locator('#pdfViewerStatus')).toHaveText('');
        // Its words reach a screen reader, which cannot read a drawing.
        await expect(pages.first().locator('.visually-hidden')).not.toHaveText('', { timeout: 10_000 });
        // In a browser tab the file may also open on its own — to print or save it.
        await expect(page.locator('#pdfViewerFoot')).toBeVisible();
        await expect(page.locator('#pdfViewerOutside')).toHaveAttribute('href', MIRROR_PACK + file.path);

        // ZOOM: the page grows and is drawn again, sharper — not the old drawing stretched.
        const before = await pages.first().evaluate(e => e.getBoundingClientRect().width);
        await expect(page.locator('#pdfViewerZoomOut')).toBeDisabled();
        await page.locator('#pdfViewerZoomIn').click();
        await expect(page.locator('#pdfViewerZoomLevel')).toHaveText('150%');
        await expect.poll(() => pages.first().evaluate(e => e.getBoundingClientRect().width)).toBeCloseTo(before * 1.5, -1);
        await expect.poll(() => pages.first().locator('canvas').evaluate((/** @type {HTMLCanvasElement} */ c) => c.width), { timeout: 15_000 })
            .toBeGreaterThanOrEqual(Math.floor(before * 1.5));
        await expect(page.locator('#pdfViewerZoomOut')).toBeEnabled();

        // THE ✕ comes back to the page, with focus where it was.
        await page.locator('#pdfViewerClose').click();
        await expect(viewer).not.toHaveClass(/\bvisible\b/);
        await expect(link).toBeFocused();
        expect(errors).toEqual([]);
        expect(logged, 'no CSP refusal, no failed worker, nothing PDF.js complained about').toEqual([]);
    });

    test('the viewer closes on Escape and Back too, and opens the next file fresh', async ({ page }) => {
        await servePack(page);
        await seedSession(page, 'G. Miller');
        await page.goto('/newlink.html');
        const files = PACK.slice(-2);
        // The tap is the viewer's: the link's own default — a tab of its own, which in an app installed from the mirror is
        // the trap — is CANCELLED. Asked of the click itself, because whether a stray tab has appeared yet is a matter of
        // timing: counting tabs straight after the viewer opened passed with the cancel deleted (mutation, 10 Nov 2026).
        const cancelled = await page.locator(`#nlPackList a.nl-file[data-file="${files[0].path}"]`).evaluate((a) => {
            const click = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
            a.dispatchEvent(click);
            return click.defaultPrevented;
        });
        expect(cancelled, 'a plain tap opens the viewer INSTEAD of the link').toBe(true);
        await expect(page.locator('#pdfViewer')).toHaveClass(/\bopen\b/);
        await page.keyboard.press('Escape');
        await expect(page.locator('#pdfViewer')).not.toHaveClass(/\bvisible\b/);

        await page.locator(`#nlPackList a.nl-file[data-file="${files[1].path}"]`).click();
        await expect(page.locator('#pdfViewerTitle')).toHaveText(files[1].label);
        await expect(page.locator('#pdfViewerSheet .pdf-viewer-page')).toHaveCount(files[1].pages, { timeout: 20_000 });
        // Android's Back button is a history step: it closes the viewer and leaves the reader on the page.
        await page.goBack();
        await expect(page.locator('#pdfViewer')).not.toHaveClass(/\bvisible\b/);
        expect(new URL(page.url()).pathname).toBe('/newlink.html');
    });

    test('a file that does not arrive says why and offers Try again — which works once it can', async ({ page }) => {
        let fail = /** @type {'gone'|'offline'|null} */ ('gone');
        await servePack(page, async (route) => {
            const cors = { 'access-control-allow-origin': '*' };   // GitHub Pages sends it on every answer, a 404 included
            if (fail === 'gone') return route.fulfill({ status: 404, body: 'Not Found', headers: cors });
            if (fail === 'offline') return route.abort('internetdisconnected');
            const path = decodeURIComponent(new URL(route.request().url()).pathname.replace('/roster-app/', ''));
            return route.fulfill({ path, contentType: 'application/pdf', headers: cors });
        });
        await seedSession(page, 'G. Miller');
        await page.goto('/newlink.html');
        const file = PACK[PACK.length - 1];
        await page.locator(`#nlPackList a.nl-file[data-file="${file.path}"]`).click();
        const status = page.locator('#pdfViewerStatus');
        await expect(status).toHaveText('This file is no longer in the pack. Reload the page to see the current files.');
        await expect(page.locator('#pdfViewerRetry')).toBeVisible();
        await expect(page.locator('#pdfViewerZoomIn')).toBeDisabled();

        fail = 'offline';
        await page.locator('#pdfViewerRetry').click();
        await expect(status).toHaveText('This file needs a connection. Check your signal, then try again.');

        fail = null;
        await page.locator('#pdfViewerRetry').click();
        await expect(page.locator('#pdfViewerSheet .pdf-viewer-page')).toHaveCount(file.pages, { timeout: 20_000 });
        await expect(status).toHaveText('');
        await expect(page.locator('#pdfViewerRetry')).toBeHidden();
    });

    // WHO IT IS NOT FOR (owner, 8 Nov 2026: "This link will only apply to people with the normal CEA contract and NOT the
    // bilingual contract who will still have their own links"), nor a CES or a Dispatcher, who have links of their own. The
    // bilingual contract is ALSO made a Links designer, on a designer list of its own (the real one is the admin alone),
    // because being a designer must not be a way in either: the gate is the contract, not the Links role.
    for (const [who, fits, designer] of /** @type {const} */ ([
        ['a CEA bilingual contract', (/** @type {any} */ m) => m.role === 'CEA' && m.bilingualContract, true],
        ['a CES', (/** @type {any} */ m) => m.role === 'CES', false],
        ['a Dispatcher', (/** @type {any} */ m) => m.role === 'Dispatcher', false],
    ])) {
        test(`${who} is sent back to the roster, and never sees the pill`, async ({ page }) => {
            const member = someone(who, fits);
            if (designer) await withLinksDesigners(page, ['G. Miller', member]);
            await seedSession(page, member);
            await page.goto('/newlink.html');
            await expect(page).toHaveURL(/\/$|\/index\.html$/);
            await page.locator('#navMenuBtn').click();
            await expect(page.locator('.nav-panel-pill--newlink')).toHaveCount(0);
        });
    }

    // WHO IT IS FOR, since v25.60 (owner, 9 Nov 2026: "send the new links section live for everyone with a cea contract and
    // the managers"): a colleague on a normal CEA contract, in no list of the page's own, and a manager, each from the drawer.
    for (const [who, member] of [
        ['a colleague on a normal CEA contract', someone('normal CEA contract', m => m.role === 'CEA' && !m.bilingualContract)],
        ['a manager', CONFIG.MANAGER_NAMES[0]],
    ]) {
        test(`${who} reaches it from the drawer`, async ({ page }) => {
            const errors = collectFatalErrors(page);
            await seedSession(page, member);
            await page.goto('/admin.html');
            await page.locator('#navMenuBtn').click();
            const pill = page.locator('.nav-panel-pill--newlink');
            await expect(pill).toBeVisible();
            await pill.click();
            await expect(page).toHaveURL(/newlink\.html$/);
            await expect(page.locator('.nl-name-title')).toHaveText(['Balanced V6', 'Level Crossing', 'Middle Ground']);
            expect(errors).toEqual([]);
        });
    }

    test('a name tile opens that proposal\'s weeks, and the two logos do what they say', async ({ page }) => {
        const errors = collectFatalErrors(page);
        await seedSession(page, 'G. Miller');
        await page.goto('/newlink.html');

        // the tile for Middle Ground opens Middle Ground's weeks, even with the weeks card folded
        await page.locator('#nlWeeksChevron').click();
        await expect(page.locator('#nlWeeksBody')).not.toHaveClass(/\bopen\b/);
        await page.locator('[data-open-weeks="proposal:MG-26-T8"]').click();
        await expect(page.locator('#nlWeeksBody')).toHaveClass(/\bopen\b/);
        await expect(page.locator('#nlWeeksPanel .is-chosen caption')).toContainText('Middle Ground');
        await expect(page.locator('[data-design="proposal:MG-26-T8"]')).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('#nlWeeksPanel .is-chosen caption')).toBeInViewport();

        // "Have your say" at the top opens its card, folded or not, and takes the reader there
        await page.locator('#nlSayChevron').click();
        await expect(page.locator('#nlSayBody')).not.toHaveClass(/\bopen\b/);
        await page.locator('#nlStatus [data-open-card="nlSay"]').click();
        await expect(page.locator('#nlSayBody')).toHaveClass(/\bopen\b/);
        await expect(page.locator('#nlSayCard h2')).toBeFocused();
        // who leads the change: Sara Silva, as the RMT rep — never the admin; and how the choice is made is left vague (owner, 4 Nov
        // 2026). Named in full, as colleagues know her, not as the roster spells her (owner, 8 Nov 2026)
        await expect(page.locator('#nlSayList')).toContainText('Tell Sara Silva or your manager what worries you');
        await expect(page.locator('#nlSayList')).toContainText('Sara Silva, the RMT rep, is leading the change.');
        await expect(page.locator('#nlSayCard')).not.toContainText(/admin|managers decide/i);
        await expect(page.locator('#nlSayCard')).toBeInViewport();

        // the drawer's logo opens About — it threw, while the page took initAboutLightbox's object for a function
        await page.locator('#navMenuBtn').click();
        await page.locator('#navPanelBrand').click();
        await expect(page.locator('#iconLightbox')).toBeVisible();
        await expect(page.locator('#iconLightbox .lightbox-badge')).toHaveText('🔁 New link');
        await page.locator('#iconLightboxClose').click();

        // the header logo goes back to the Calendar, as its alt text has always said — and the test waits
        // for the Calendar to DRAW: it used to end the moment the URL changed, with the Calendar's modules
        // still loading through the suite's routes, which failed it once in a full run (v25.20). Its grid
        // or its member card, whichever this harness earns: there is no Firebase identity here, so the
        // Calendar asks this member to sign in again, which is the right answer to that.
        await expect(page.locator('#appIcon')).toHaveAttribute('role', 'button');
        await page.locator('#appIcon').click();
        await expect(page).toHaveURL(/\/$/);
        await expect(page.locator('.calendar-day, #calLockWhy:not(:empty)').first()).toBeVisible();
        expect(errors).toEqual([]);
    });

    // WHO DECIDES IS NEVER SAID TO BE THE ADMIN — ANYWHERE ON THE PAGE, IN ANY STATE IT SHOWS (test audit, 7 Nov 2026,
    // LNK-8). The test above reads only the Have-your-say card, so "The admin will choose one of the three." added after
    // "Nothing is decided." in the status line passed every lane. This reads the page's whole text as it opens and with
    // every way of working drawn in full — the changes, what all three share, the notes, the six personas and all three
    // proposals' weeks are all in it then (the weeks are drawn for all three; the tabs only choose which one shows). No
    // place on it may name the admin now: the preview banner, which told S. Silva "only you and the admin can see this
    // page", went on 8 Nov 2026, so the whole text is read, as the admin and as her.
    for (const reader of ['G. Miller', 'S. Silva']) {
        test(`nothing names the admin, or managers, as the ones who decide — read as ${reader}`, async ({ page }) => {
            await seedSession(page, reader);
            await page.goto('/newlink.html');
            await expect(page.locator('.nl-name-title')).toHaveCount(3);
            const pageText = () => page.evaluate(() => {
                const main = /** @type {HTMLElement} */ (document.getElementById('newlinkMain'));
                return (main.textContent || '').replace(/\s+/g, ' ');
            });
            const opened = await pageText();
            expect(opened, 'premise: the status line, the changes and the notes are on the page').toContain('Nothing is decided.');
            expect(opened, 'as the page opens').not.toMatch(/admin|managers decide/i);

            await page.locator('[data-persona="all"]').click();
            await expect(page.locator('#nlPersonaPanel .nl-persona')).toHaveCount(6);
            expect(await pageText(), 'with all six ways of working drawn').not.toMatch(/admin|managers decide/i);
        });
    }

    test('the admin reaches it from the drawer', async ({ page }) => {
        await seedSession(page, 'G. Miller');
        await page.goto('/admin.html');
        await page.locator('#navMenuBtn').click();
        const pill = page.locator('.nav-panel-pill--newlink');
        await expect(pill).toBeVisible();
        await pill.click();
        await expect(page).toHaveURL(/newlink\.html$/);
        await expect(page.locator('.nl-name-title').first()).toHaveText('Balanced V6');
    });

    // S. Silva is the new link's contact (newlink-config.js → CONTACT), and saw the page before colleagues did, in its
    // preview (owner, 4 Nov 2026: "open up the new links page to S. Silva"; CONFIG.NEWLINK_PREVIEW).
    test('S. Silva reaches it from the drawer too, and sees what colleagues do, with no preview banner', async ({ page }) => {
        await seedSession(page, 'S. Silva');
        await page.goto('/admin.html');
        await page.locator('#navMenuBtn').click();
        const pill = page.locator('.nav-panel-pill--newlink');
        await expect(pill).toBeVisible();
        await pill.click();
        await expect(page).toHaveURL(/newlink\.html$/);
        await expect(page.locator('.nl-name-title').first()).toHaveText('Balanced V6');
        await expect(page.locator('#nlPreview, .nl-preview')).toHaveCount(0);
    });
});
