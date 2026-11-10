/**
 * operations.spec.js — Operations (operations.html): usage and speed cards, reset requests, account status, attention strip.
 *
 * Split out of pages.spec.js on 3 Nov 2026, test for test and unchanged: the tests that span
 * pages, and the shared drawer, dialogs and sheets, stay there.
 */
import { test, expect } from './fixtures.js';
import { collectFatalErrors, seedSession, seedMember, openRosterReview, stubPerfReads, perfSamples, stubUsageReads, usageStats, ROSTER_REVIEW_DATES, ROSTER_REVIEW_PARSE, isTouchProject } from './helpers.js';
import { teamMembers, getBaseShift } from '../roster-data.js';

// ── OPERATIONS (operations.html) ──────────────────────────────────────────

test('operations: shows the in-place login when not signed in', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.goto('/operations.html');
    // No redirect any more (Option B) — the shared login overlay is injected in place.
    await expect(page).toHaveURL(/operations\.html/);
    await expect(page.locator('#loginOverlay')).toBeVisible();
    expect(errors, 'Uncaught JS exceptions triggering operations redirect').toHaveLength(0);
});

// Desktop layout contract: the wrapper-column grid (v14.35) must keep the three
// publishing cards in the narrow LEFT column and the width-hungry cards (roster +
// monitoring) in the wide RIGHT column — not auto-placed into mismatched positions.
for (const width of [1280, 1440]) {
    test(`operations desktop @${width}px: cards land in the right columns, no overflow`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await seedSession(page, 'G. Miller');   // admin — passes the operations guard
        await page.goto('/operations.html');
        await expect(page).toHaveURL(/operations\.html$/);   // admin was NOT redirected out
        await expect(page.locator('#huddleUploadCard')).toBeVisible();

        const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, 'no horizontal overflow on desktop').toBeLessThanOrEqual(1);

        // The two columns must not overlap horizontally: every left-column (publishing)
        // card's right edge sits left of every right-column (roster + monitoring) card's
        // left edge. Comparing the columns to EACH OTHER (not the viewport centre) is
        // robust to the centred max-width:1100 container + narrow-left/wide-right split.
        // An auto-placement regression (the v14.31 symptom) would break this separation.
        const leftIds  = ['#huddleUploadCard', '#circularUploadCard', '#newsletterUploadCard'];
        const rightIds = ['#rosterUploadCard', '#accountStatusCard', '#errorLogCard', '#usageCard', '#pageSpeedCard', '#authSetupCard'];
        const boxesOf = async ids => Promise.all(ids.map(id => page.locator(id).boundingBox()));
        const leftBoxes  = await boxesOf(leftIds);
        const rightBoxes = await boxesOf(rightIds);
        const leftColumnRight = Math.max(...leftBoxes.map(b => b.x + b.width));
        const rightColumnLeft = Math.min(...rightBoxes.map(b => b.x));
        expect(leftColumnRight, 'left column must sit entirely left of the right column')
            .toBeLessThanOrEqual(rightColumnLeft + 1);
        // And the right (wide) column should genuinely be wider than the left (narrow) one.
        const rightWidth = rightBoxes[0].width, leftWidth = leftBoxes[0].width;
        expect(rightWidth, 'roster column should be wider than the publishing column').toBeGreaterThan(leftWidth);
    });
}

// App speed card (Project 0): renders its plain-language summary without throwing. Firebase is
// stubbed (getDoc → empty), so getPerfStats yields no data and the card shows the "still building
// up" empty state — proving the read + perfVerdict + render path runs end-to-end.
test('operations: App speed card renders both sections + empty-state verdict (no throw)', async ({ page }) => {
    await seedSession(page, 'G. Miller');
    await page.goto('/operations.html');
    await expect(page.locator('#pageSpeedCard')).toBeVisible();
    // Two journeys: "Signing in" (login) + "Opening pages" (page-open), both empty on a stubbed read.
    await expect(page.locator('#pageSpeedContent')).toContainText('Signing in');
    await expect(page.locator('#pageSpeedContent')).toContainText('Opening pages');
    await expect(page.locator('#pageSpeedContent')).toContainText('No sign-ins recorded'); // login empty state (month-neutral copy, v16.22)
    await expect(page.locator('#pageSpeedContent')).toContainText('No page opens recorded for this period.'); // pages empty state, month-neutral too
    // The note explaining why "Usable" is smaller than the two above has nothing to explain here.
    await expect(page.locator('#pageSpeedContent')).not.toContainText('its total is smaller');
});

// ── "A closer look" (Oct 2026; "Why some are slower" from v20.19) ───────────────────────────────
// The card recorded install mode and app version with every load and once threw both away at render
// time. The maths is unit-tested; only a browser proves the section is REACHED — it hangs off
// `w.samples`, a field a wiring slip would drop with every unit test green. Since the App Speed
// review the splits run on USABLE rather than code loading: their readers took them for the whole
// load, and read "newer versions are slower" off rows that measured only the code arriving.
test('operations: App speed splits the busiest page’s Usable opens by app version and by how it was opened', async ({ page }) => {
    await page.addInitScript(() => {
        window.__E2E = { ...(window.__E2E || {}), getDocData: { samples: {
            // Usable: quick in the installed app, slow in a browser tab (and few of those), and a
            // straggling older release whose every open took over a second.
            '24_96|calendar|ready|lt500ms|standalone|4g': 300,
            '24_96|calendar|ready|over8s|browser|3g': 3,
            '24_9|calendar|ready|1-3s|standalone|4g': 40,
            // Code loaded — the busiest page, and deliberately the OPPOSITE shape, every open quick:
            // a split read from it instead of from Usable would print 0% on every row.
            '24_96|calendar|domReady|lt500ms|standalone|4g': 343,
            '24_96|paycalc|domReady|lt500ms|standalone|4g': 20,
        } } };
    });
    await seedSession(page, 'G. Miller');
    await page.goto('/operations.html');
    const speed = page.locator('#pageSpeedContent');
    await expect(speed.locator('h3', { hasText: 'A closer look' })).toContainText('Calendar');   // the BUSIEST page, named
    await expect(speed).toContainText('By app version — Usable');
    await expect(speed).toContainText('By how it was opened — Usable');
    await expect(speed, 'the connection comparison went with the investigation it served').not.toContainText('By connection');
    await expect(speed).not.toContainText('Why some are slower');
    // Newest first, and NUMERICALLY: a string sort would put v24.9 above v24.96.
    const vs = (await speed.locator('.speed-row--why .speed-row-name').allTextContents()).filter(t => t.startsWith('v'));
    expect(vs).toEqual(['v24.96', 'v24.9']);
    // The USABLE figure: the older release's 40 opens were all 1–3s, so 100% over a second, where
    // code loaded would say 0%.
    const older = speed.locator('.speed-row--why', { hasText: 'v24.9' }).filter({ hasNotText: 'v24.96' }).first();
    await expect(older.locator('.speed-row-count')).toHaveText(/^100%/);
    await expect(older.locator('.speed-row-sub')).toHaveText(/^40\b/);
    // And the honesty marker on the three-open group, without which it reads as confidently as the 340.
    await expect(speed.locator('.speed-row--why', { hasText: 'Browser tab' }).first()).toContainText('(few)');
});

// ── The THIRD milestone (v20.80) ────────────────────────────────────────────────────────────────
// `fcp` and `domReady` were labelled "First appears" and "Fully ready", and the v20.12 access gate
// made both stop describing what an admin reads them as: `fcp` is the splash painting, and DCL now
// fires while the Calendar is still blank. Measured — fcp 512ms, domReady 669ms, roster on screen
// 2630ms. `ready` is the milestone neither of them can be, and the point of testing it in a browser
// rather than in the pure suite is the LAYOUT: a third bar per page is a real grid change, and a
// column that collapses is invisible to every assertion about the data behind it.
test('operations: App speed shows THREE milestones, and a page with no ready data says so', async ({ page }) => {
    await page.addInitScript(() => {
        window.__E2E = { ...(window.__E2E || {}), getDocData: { samples: {
            // The Calendar reports all three. The gap between "code loaded" and "usable" is the
            // finding the metric exists for, so the fixture carries it: quick code, slow page.
            '20_80|calendar|fcp|lt500ms|standalone|4g': 200,
            '20_80|calendar|domReady|500ms-1s|standalone|4g': 200,
            '20_80|calendar|ready|1-3s|standalone|4g': 200,
            // Paycalc does not mark the milestone. Its cell must be EMPTY, not borrowed from
            // another bar — a filled-in figure would be a number nobody measured.
            '20_80|paycalc|fcp|lt500ms|standalone|4g': 30,
            '20_80|paycalc|domReady|lt500ms|standalone|4g': 30,
        } } };
    });
    await seedSession(page, 'G. Miller');
    await page.goto('/operations.html');
    const speed = page.locator('#pageSpeedContent');
    await expect(speed).toContainText('First appears');
    await expect(speed).toContainText('Code loaded');
    await expect(speed).toContainText('Usable');
    // The relabel matters as much as the new bar: "Fully ready" was the phrase that made domReady
    // read as the answer, and it now belongs to `ready` alone.
    await expect(speed).not.toContainText('Fully ready');
    // The verdict for `ready` is driven by ITS OWN samples — all in the 1–3s band, so it must not
    // report the quick verdict `domReady` earns. Nor "mostly become usable quickly" (v24.85): this
    // regex accepted that sentence until then, and with NONE of these opens under a second it is the
    // very misstatement that release removed from the card.
    await expect(speed).toContainText('Pages most often take a moment to become usable.');
    await expect(speed).not.toContainText(/usable quickly/i);

    // Three bars per page row, and the header names all three columns.
    const calRow = speed.locator('.speed-row--dual', { hasText: 'Calendar' }).first();
    await expect(calRow.locator('.speed-bar')).toHaveCount(3);
    // Pay calculator does not report the milestone: the cell holds a DASH, not an empty track. An
    // unfilled bar beside a filled one reads as 0%, which is a measurement and the wrong one.
    const payRow = speed.locator('.speed-row--dual', { hasText: 'Pay' }).first();
    await expect(payRow.locator('.speed-bar')).toHaveCount(2);
    await expect(payRow.locator('.speed-bar-none')).toHaveText('—');
    // …and a screen reader is told the same: an aria-label on a bare span is not reliably read.
    await expect(payRow.locator('.speed-bar-none')).toHaveAttribute('role', 'img');
    await expect(payRow.locator('.speed-bar-none')).toHaveAttribute('aria-label', 'usable: not reported');

    // The grid really is three columns — a collapsed one would still pass every count above.
    // OPEN the card first. It is collapsed by default, so every assertion above passes on markup
    // that is `display:none` — which is exactly how a collapsed column would go unnoticed.
    await page.locator('#pageSpeedToggleHeader').click();
    await expect(speed).toBeVisible();
    // Read the RESOLVED track widths off the children, not the declaration: a column that collapsed
    // to zero would still be declared, which is the failure this guards.
    const widths = await calRow.evaluate(el =>
        [...el.children].map(c => Math.round(c.getBoundingClientRect().width)));
    expect(widths.length).toBe(5);
    expect(widths.slice(1, 4).every(w => w > 30)).toBe(true);
});

// ── The retired blocks stay retired (App Speed review, Oct 2026) ─────────────────────────────────
// Every month before Oct 2026 carries the boot phases, the start ladder's rungs, the saved-copy split,
// the fast path and the worker's file count. The card must read past them, not resurrect a block for
// a question `LATENCY.md` closed on 19 September.
test('operations: a month still holding the retired metrics renders none of their blocks', async ({ page }) => {
    await page.addInitScript(() => {
        const k = (m, b, n, mode = 'standalone', conn = '4g') => [`24_80|calendar|${m}|${b}|${mode}|${conn}`, n];
        window.__E2E = { ...(window.__E2E || {}), getDocData: { samples: Object.fromEntries([
            k('domReady', 'lt500ms', 300), k('domReady', '1-3s', 90, 'browser', '3g'),
            k('ready', 'lt500ms', 250), k('ready', '1-3s', 60, 'browser'),
            k('swBoot', 'lt500ms', 300), k('sdkLoad', '500ms-1s', 300), k('appBoot', 'lt500ms', 300), k('ttfb', 'lt500ms', 300),
            k('authBoot', '1-3s', 300), k('access', 'lt500ms', 300), k('rosterCached', 'lt500ms', 280), k('rosterLive', '1-3s', 290),
            k('readyCached', 'lt500ms', 240), k('readyFetched', '1-3s', 60), k('readyProvisional', 'lt500ms', 30),
            k('swrCount', '31+', 200), k('swrCount', '0', 90), k('readyHeavySwr', '1-3s', 40),
        ]) } };
    });
    await seedSession(page, 'G. Miller');
    await page.goto('/operations.html');
    const speed = page.locator('#pageSpeedContent');
    // The closer look DID render (its mode split has two rows), so the absences below mean something.
    await expect(speed).toContainText('By how it was opened — Usable');
    for (const gone of ['By stage of start-up', 'How far the start gets', 'What put the shifts on screen',
        'did not wait for the sign-in check', 'background worker', 'Does the connection slow the start?', 'By connection']) {
        await expect(speed, `retired: ${gone}`).not.toContainText(gone);
    }
});

// ── This month / Last month (App Speed review, Oct 2026) ─────────────────────────────────────────
// No test had ever pressed Last month, and every fixture served the same samples for both months —
// so the switch could have shown this month's figures under "Last month" with every suite green.
test('operations: App speed’s month switch shows each month’s own figures', async ({ page }, testInfo) => {
    await stubPerfReads(page, { lastMonth: {
        'v24.80|login|loginTotal|1-3s|standalone|4g': 33,
        'v24.80|calendar|domReady|lt500ms|standalone|4g': 50,
        'v24.80|calendar|ready|1-3s|standalone|4g': 41,
    } });
    await seedSession(page, 'G. Miller');
    await page.goto('/operations.html');
    await expect(page.locator('#pageSpeedCard')).toBeVisible({ timeout: 10000 });
    await page.evaluate(() => {
        const b = document.getElementById('pageSpeedBody');
        if (b && !b.classList.contains('open')) document.getElementById('pageSpeedToggleHeader')?.click();
    });
    const speed = page.locator('#pageSpeedContent');
    const thisBtn = speed.getByRole('button', { name: 'This month' });
    const lastBtn = speed.getByRole('button', { name: 'Last month' });
    await expect(thisBtn).toHaveAttribute('aria-pressed', 'true');
    await expect(lastBtn).toHaveAttribute('aria-pressed', 'false');
    await expect(speed).toContainText('71 sign-ins this month');
    await expect(speed).toContainText('By page — August 2026');
    await expect(speed).toContainText('Two ways of timing this month.');
    await expect(speed, 'the record-size line belongs to the month still being written').toContainText(/This month’s speed record is .+ full/);

    await lastBtn.click();
    await expect(lastBtn).toHaveAttribute('aria-pressed', 'true');
    await expect(thisBtn).toHaveAttribute('aria-pressed', 'false');
    await expect(speed).toContainText('33 sign-ins last month');
    await expect(speed).not.toContainText('71 sign-ins');
    await expect(speed).toContainText('By page — July 2026');
    await expect(speed).toContainText('Timed the older way.');          // all of July predates v24.98
    await expect(speed).not.toContainText('speed record');

    await thisBtn.click();
    await expect(speed).toContainText('71 sign-ins this month');
    // A touch target on a coarse pointer, not a 26px pill: the app's compact 36px tier.
    if (isTouchProject(testInfo)) {
        expect(await thisBtn.evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(36);
    }
});

// ── The big number says what it is (App Speed review, Oct 2026) ─────────────────────────────────
// It is the share that was QUICK, and the panel's colour comes from the share that was SLOW — so a
// red "30%" read as "30% bad". The word under it is the fix; the sub-line still names all three.
test('operations: App speed’s headline number says it is the quick share', async ({ page }) => {
    await page.addInitScript(() => {
        window.__E2E = { ...(window.__E2E || {}), getDocData: { samples: {
            'v24.98|login|loginTotal|lt500ms|standalone|4g': 30,
            'v24.98|login|loginTotal|1-3s|standalone|4g': 20,
            'v24.98|login|loginTotal|3-8s|standalone|4g': 50,
        } } };
    });
    await seedSession(page, 'G. Miller');
    await page.goto('/operations.html');
    const login = page.locator('#pageSpeedContent .speed-verdict').first();
    await expect(login).toHaveClass(/speed-verdict--bad/);
    await expect(login.locator('.speed-verdict-figure')).toHaveText('30%');
    await expect(login.locator('.speed-verdict-cap')).toHaveText('quick');
    await expect(login).toContainText('30% under 1s · 20% 1–3s · 50% over 3s');
    // Every sample here is from v24.98 on, so there is no older timing to warn about.
    await expect(page.locator('#pageSpeedContent .speed-note--transition')).toHaveCount(0);
    // And the bar beneath is DRAWN at those widths — the review found a bar at the wrong widths
    // passed everything, the screenshot lane included, which only reports and tolerates small drift.
    await page.evaluate(() => {
        const b = document.getElementById('pageSpeedBody');
        if (b && !b.classList.contains('open')) document.getElementById('pageSpeedToggleHeader')?.click();
    });
    const bar = page.locator('#pageSpeedContent .speed-bar--overall').first();
    await expect(bar).toBeVisible();
    const shares = await bar.evaluate(el => {
        const total = el.getBoundingClientRect().width - 2;           // inside its 1px border
        return [...el.querySelectorAll('.speed-seg')].map(seg => seg.getBoundingClientRect().width / total);
    });
    expect(shares.map(x => Math.round(x * 100))).toEqual([30, 20, 50]);
});

// ── Explanations on screen, sections as headings, colour not alone (App Speed review, Oct 2026) ───
// Every row had a one-line explanation in the code that only a screen reader heard; the sections were
// paragraphs a screen reader could not jump between; and the slow band was red alone.
test('operations: App speed explains each moment and row on screen, under real headings', async ({ page }) => {
    await stubPerfReads(page);
    await page.setViewportSize({ width: 1280, height: 2400 });
    await seedSession(page, 'G. Miller');
    await page.goto('/operations.html');
    await expect(page.locator('#pageSpeedCard')).toBeVisible({ timeout: 10000 });
    await page.evaluate(() => {
        const b = document.getElementById('pageSpeedBody');
        if (b && !b.classList.contains('open')) document.getElementById('pageSpeedToggleHeader')?.click();
    });
    const speed = page.locator('#pageSpeedContent');
    await expect(speed.locator('h3')).toHaveText([/Signing in/, /Opening pages/, /A closer look/]);
    await expect(speed.locator('h4.speed-subhead--sub')).toHaveText([/First appears/, /Code loaded/, /Usable/, /By page/]);
    for (const line of ['Something is on screen', 'The app’s code has run', 'ready to use']) {
        await expect(speed.getByText(line, { exact: false }).first()).toBeVisible();
    }
    const own = speed.locator('.speed-row--why', { hasText: 'Own roster' });
    await expect(own.locator('.speed-row-expl')).toBeVisible();
    await expect(own.locator('.speed-row-expl')).toContainText('from opening the Calendar');
    await expect(speed.locator('.speed-row--why', { hasText: 'Until usable' }).locator('.speed-row-expl')).toBeVisible();
    // Striped as well as red — a computed-style fact that no screenshot tolerance would notice.
    for (const sel of ['.speed-seg--bad', '.speed-dot--bad']) {
        const bg = await speed.locator(sel).first().evaluate(el => getComputedStyle(el).backgroundImage);
        expect(bg, sel).toContain('repeating-linear-gradient');
    }
});

// ── The polish pass, measured (Oct 2026) ──────────────────────────────────────────────────────────
// Every rule here was found by measuring screenshots, and none is something a screenshot tolerance
// would reliably catch: a column label 20px off its numbers, a bar exactly halfway between two moments,
// panel sentences 1–3px apart, three ranks of heading all at 12px. At a phone width, where the card
// is most often read and where the panel's count drops to a line of its own.
test('operations: App speed labels sit over their numbers, bars stay with their panels, sentences share one edge', async ({ page }) => {
    // No sign-ins this month, so the first panel is the empty dash beside three with figures — the case
    // the number column's floor exists for. Two-digit figures alone line up on tabular digits.
    const noSignIns = Object.fromEntries(Object.entries(perfSamples()).filter(([k]) => !k.includes('|loginTotal|')));
    await stubPerfReads(page, { thisMonth: noSignIns, lastMonth: noSignIns });
    await page.setViewportSize({ width: 375, height: 2400 });
    await seedSession(page, 'G. Miller');
    await page.goto('/operations.html');
    await expect(page.locator('#pageSpeedCard')).toBeVisible({ timeout: 10000 });
    await page.evaluate(() => {
        const b = document.getElementById('pageSpeedBody');
        if (b && !b.classList.contains('open')) document.getElementById('pageSpeedToggleHeader')?.click();
    });
    const speed = page.locator('#pageSpeedContent');
    await expect(speed.locator('.speed-row-name').first()).toBeVisible();
    const m = await speed.evaluate((root) => {
        /** The box of an element's FIRST text node — its visible figure, not a visually-hidden suffix. */
        const textBox = (/** @type {Element} */ el) => {
            const r = document.createRange();
            r.selectNodeContents(/** @type {Node} */ (el.firstChild));
            return r.getBoundingClientRect();
        };
        // Each numeric column label ends where the first value under it ends: "opens", and "over 1s".
        const labels = [...root.querySelectorAll('.speed-rows')].flatMap(list => {
            const head = [...list.querySelector('.speed-dual-head').children];
            const row = [...list.querySelector('.speed-row:not(.speed-dual-head)').children];
            const cols = list.querySelector('.speed-row--why') ? [head.length - 2, head.length - 1] : [head.length - 1];
            return cols.map(i => Math.abs(textBox(head[i]).right - textBox(row[i]).right));
        });
        // "first appears" wraps on a phone and "usable" does not: the labels share a bottom line.
        const dual = [...root.querySelector('.speed-row--dual.speed-dual-head').children].filter(c => c.textContent);
        const bottoms = dual.map(c => Math.round(textBox(c).bottom));
        // Each bar is nearer its own panel than the heading after it (a note that follows explains the
        // bar, and is left out).
        const bars = [...root.querySelectorAll('.speed-bar--overall')]
            .filter(bar => bar.nextElementSibling?.matches('.speed-subhead'))
            .map(bar => ({
                above: bar.getBoundingClientRect().top - /** @type {Element} */ (bar.previousElementSibling).getBoundingClientRect().bottom,
                below: /** @type {Element} */ (bar.nextElementSibling).getBoundingClientRect().top - bar.getBoundingClientRect().bottom,
            }));
        const sentenceLefts = [...root.querySelectorAll('.speed-verdict-text')].map(t => Math.round(t.getBoundingClientRect().left));
        const counts = [...root.querySelectorAll('.speed-verdict-count')].map(c => getComputedStyle(c).display);
        const size = (/** @type {string} */ sel) => parseFloat(getComputedStyle(/** @type {Element} */ (root.querySelector(sel))).fontSize);
        return { labels, bottoms, bars, sentenceLefts, counts,
            sizes: [size('h3.speed-subhead'), size('h4.speed-subhead--sub'), size('h4.speed-dim-label')] };
    });
    for (const gap of m.labels) expect(gap, 'a column label is off the numbers it names').toBeLessThanOrEqual(1);
    expect(new Set(m.bottoms).size, `column labels end on different lines: ${m.bottoms}`).toBe(1);
    expect(m.bars.length).toBeGreaterThan(0);
    for (const { above, below } of m.bars) expect(below, `a bar ${above}px under its panel and ${below}px over the next heading`).toBeGreaterThanOrEqual(2 * above);
    expect(new Set(m.sentenceLefts).size, `panel sentences start at ${m.sentenceLefts}`).toBe(1);
    expect(m.sentenceLefts.length).toBe(4);
    expect(m.counts.length).toBe(3);
    for (const d of m.counts) expect(d, 'below 480px the count takes a line of its own').toBe('block');
    // One step per rank: section, then moment, then the closer-look label.
    expect(m.sizes[0]).toBeGreaterThan(m.sizes[1]);
    expect(m.sizes[1]).toBeGreaterThan(m.sizes[2]);
});

// The 1st of a month: four empty panels said "Fills in as staff use the app over the coming days." four
// times. It is said once, on the first of them.
test('operations: an empty App speed month says it fills in once, not on every panel', async ({ page }) => {
    await stubPerfReads(page, { thisMonth: {}, lastMonth: {} });
    await page.setViewportSize({ width: 375, height: 1600 });
    await seedSession(page, 'G. Miller');
    await page.goto('/operations.html');
    await expect(page.locator('#pageSpeedCard')).toBeVisible({ timeout: 10000 });
    await page.evaluate(() => {
        const b = document.getElementById('pageSpeedBody');
        if (b && !b.classList.contains('open')) document.getElementById('pageSpeedToggleHeader')?.click();
    });
    const speed = page.locator('#pageSpeedContent');
    await expect(speed.locator('.speed-verdict')).toHaveCount(4);
    await expect(speed.getByText('Fills in as staff use the app over the coming days.')).toHaveCount(1);
    await expect(speed.locator('.speed-verdict').first()).toContainText('Fills in');
});

// ── Each "By page" bar answers for its own count (App Speed review, Oct 2026) ─────────────────────
// The row's "(few)" came from the code-loaded count, so a Usable bar built from 6 opens beside 500
// code-loaded ones wore no marker and read like a finding.
test('operations: a thin Usable bar beside a full code-loaded one wears its own "(few)"', async ({ page }) => {
    await page.addInitScript(() => {
        window.__E2E = { ...(window.__E2E || {}), getDocData: { samples: {
            'v24.98|calendar|fcp|lt500ms|standalone|4g': 500,
            'v24.98|calendar|domReady|lt500ms|standalone|4g': 500,
            'v24.98|calendar|ready|3-8s|standalone|4g': 6,
        } } };
    });
    await seedSession(page, 'G. Miller');
    await page.goto('/operations.html');
    const calRow = page.locator('#pageSpeedContent .speed-row--dual', { hasText: 'Calendar' }).first();
    const cells = calRow.locator(':scope > *');
    await expect(cells.nth(3).locator('.speed-cell-few'), 'the Usable cell').toHaveText('(few)');
    await expect(cells.nth(2).locator('.speed-cell-few'), 'the code-loaded cell').toHaveCount(0);
    await expect(cells.nth(3).locator('.speed-bar')).toHaveAttribute('aria-label', /^usable: .*from 6 opens, too few to read into$/);
    await expect(calRow.locator('.speed-row-label')).not.toContainText('(few)');
});

// ── A share never rounds to a lie (App Speed review, Oct 2026) ───────────────────────────────────
test('operations: a share that rounds to nothing reads "<1%", and one short of all ">99%"', async ({ page }) => {
    await page.addInitScript(() => {
        window.__E2E = { ...(window.__E2E || {}), getDocData: { samples: {
            '24_96|calendar|ready|lt500ms|standalone|4g': 399,
            '24_96|calendar|ready|1-3s|standalone|4g': 1,
            '24_95|calendar|ready|lt500ms|standalone|4g': 50,
            '24_96|calendar|domReady|lt500ms|standalone|4g': 450,
        } } };
    });
    await seedSession(page, 'G. Miller');
    await page.goto('/operations.html');
    const speed = page.locator('#pageSpeedContent');
    const newer = speed.locator('.speed-row--why', { hasText: 'v24.96' }).first();
    await expect(newer.locator('.speed-row-count'), '1 of 400 over a second is not "0%"').toHaveText(/^<1%/);
    await expect(speed.locator('.speed-row--why', { hasText: 'v24.95' }).first().locator('.speed-row-count')).toHaveText(/^0%/);
    const usable = speed.locator('.speed-verdict').nth(3);
    await expect(usable.locator('.speed-verdict-figure'), '449 of 450 is not "100%"').toHaveText('>99%');
    await expect(usable).toContainText('<1% 1–3s');
});

// ── The month the measurement changed (App Speed review, Oct 2026) ───────────────────────────────
test('operations: App speed says when a month mixes two ways of timing', async ({ page }) => {
    await page.addInitScript(() => {
        window.__E2E = { ...(window.__E2E || {}), getDocData: { samples: {
            '24_97|calendar|domReady|lt500ms|standalone|4g': 100,
            '24_98|calendar|domReady|lt500ms|standalone|4g': 100,
        } } };
    });
    await seedSession(page, 'G. Miller');
    await page.goto('/operations.html');
    const note = page.locator('#pageSpeedContent .speed-note--transition');
    await expect(note).toContainText('Two ways of timing this month.');
    await expect(note).toContainText('From v24.98');
    await expect(note).toContainText('50% of these opens were timed the older way');
});

// A WORK EMAIL IS READ WHOLE, AT EVERY WIDTH (Nov 2026). The card is where an admin checks an address
// is right, and it cut them with an ellipsis the app has no tooltip to undo: on a phone, and at a desk,
// where the one-line row of the desktop audit left the address ~130px at every width — a typical one cut
// at 1366, and at 1024 not even "No work email" fitted. An invented address, longer than any real one.
const LONG_EMAIL = 'firstname.considerablylongersurname@chilternrailways.co.uk';

/** Serve the account cards one stored address — LONG_EMAIL, for the first member the card lists.
 *  @param {import('@playwright/test').Page} page */
async function seedLongEmail(page) {
    const first = teamMembers.find(m => !m.hidden || m.managerOnly)?.name;
    await page.addInitScript(([name, email]) => {
        /** @type {any} */ (window).__E2E = { authUser: true, docs: [], docsByPath: {
            staffContact: [{ id: name, memberName: name, workEmail: email }], passwordStatus: [], resetRequests: [] } };
    }, [first, LONG_EMAIL]);
}

/** The email's row and how its address is drawn: whole (no ellipsis, nothing scrolled away, no ancestor
 *  clipping any of it), on how many lines, and whether its line sits beside the head or under it.
 *  @param {import('@playwright/test').Page} page */
async function longEmailRow(page) {
    await page.evaluate(() => /** @type {HTMLElement|null} */ (
        document.querySelector('#accountStatusCard .card-header-toggle'))?.click());
    const row = page.locator('.acct-row').filter({ hasText: LONG_EMAIL });
    await expect(row).toBeVisible();
    return row.evaluate(r => {
        const em = /** @type {HTMLElement} */ (r.querySelector('.acct-email'));
        const range = document.createRange(); range.selectNodeContents(em);
        const bits = [...range.getClientRects()].filter(q => q.width > 0);
        const clippedBy = [];
        for (let a = em.parentElement; a && a !== document.body; a = a.parentElement) {
            const cs = getComputedStyle(a);
            if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
            const box = a.getBoundingClientRect();
            if (bits.some(q => q.left < box.left - 1 || q.right > box.right + 1 || q.top < box.top - 1 || q.bottom > box.bottom + 1)) clippedBy.push(a.id || a.className);
        }
        const head = /** @type {HTMLElement} */ (r.querySelector('.acct-row-head')).getBoundingClientRect();
        const line = /** @type {HTMLElement} */ (r.querySelector('.acct-row-email')).getBoundingClientRect();
        const rem = /** @type {HTMLElement} */ (r.querySelector('.email-set-btn--remove')).getBoundingClientRect();
        // Where it breaks: the text before the <wbr> on one line, the domain after it on the next.
        const tops = (/** @type {Node|null|undefined} */ n) => { if (!n) return []; const g = document.createRange(); g.selectNodeContents(n);
            return [...new Set([...g.getClientRects()].filter(q => q.width > 0).map(q => Math.round(q.top)))]; };
        const wbr = em.querySelector('wbr'), local = tops(wbr?.previousSibling), domain = tops(wbr?.nextSibling);
        return { text: em.textContent, scrolled: em.scrollWidth - em.clientWidth, ellipsis: getComputedStyle(em).textOverflow === 'ellipsis' && em.scrollWidth > em.clientWidth,
                 clippedBy, lines: new Set(bits.map(q => Math.round(q.top))).size, underHead: line.top >= head.bottom - 1,
                 breaksAtTheAt: local.length === 1 && domain.length === 1 && domain[0] > local[0],
                 firstLine: Math.round(bits[0]?.width ?? 0),
                 removeInRow: rem.right <= r.getBoundingClientRect().right + 1 };
    });
}

// Account-status email rows must not overflow the card on a narrow phone (merged card, v18.65) — the
// v14.35 bug class, where a long address forced the row wide and overflow:hidden clipped the fixed-width
// Edit/Remove buttons. They stay on-screen now because the address WRAPS beside them, whole.
test('operations: Account-status email rows keep Edit/Remove on-screen at 375px, and a long address wraps whole', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 760 });
    await seedLongEmail(page);
    await seedSession(page, 'G. Miller');
    await page.goto('/operations.html');
    await expect(page.locator('#accountStatusCard')).toBeVisible();
    const m = await longEmailRow(page);
    expect(m.text, 'the address is all there, the 📧 held to it').toBe(`📧\u00a0${LONG_EMAIL}`);
    expect(m.ellipsis, 'no ellipsis').toBe(false);
    expect(m.scrolled, 'nothing scrolled out of the box').toBeLessThanOrEqual(0);
    expect(m.clippedBy, 'and no ancestor cuts any of it').toEqual([]);
    expect(m.lines, 'it wraps, rather than forcing the row wide').toBeGreaterThan(1);
    expect(m.firstLine, 'and the 📧 is never left alone on the first line').toBeGreaterThan(40);
    expect(m.removeInRow, 'Remove stays inside the row').toBe(true);
    const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, 'no horizontal overflow').toBeLessThanOrEqual(1);
});

test('operations: at a desk a long work email is read whole, on a line of its own, while at 1366 an account without one stays one line', async ({ page }, info) => {
    test.skip(isTouchProject(info), 'a desk-sized window and a mouse');
    await seedLongEmail(page);
    await seedSession(page);
    await seedMember(page);
    for (const width of [1024, 1366]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto('/operations.html');
        await expect(page.locator('#accountStatusCard')).toBeVisible({ timeout: 10000 });
        const m = await longEmailRow(page);
        expect(m.ellipsis, `${width}: no ellipsis`).toBe(false);
        expect(m.scrolled, `${width}: nothing scrolled out of the box`).toBeLessThanOrEqual(0);
        expect(m.clippedBy, `${width}: no ancestor cuts any of it`).toEqual([]);
        expect(m.underHead, `${width}: the row cannot hold it beside the head, so its line is under it`).toBe(true);
        expect(m.lines, `${width}: where it has the row's width, at most two lines`).toBeLessThanOrEqual(2);
        // …and at 1024, where it needs two, they break at the @ — the 📧 held to the name before it.
        if (width === 1024) expect(m.breaksAtTheAt, '1024: name@ on one line, the domain on the next').toBe(true);
        expect(m.removeInRow, `${width}: Remove stays inside the row`).toBe(true);
        const others = await page.evaluate((long) => [...document.querySelectorAll('.acct-row')]
            .filter(r => !(r.textContent ?? '').includes(long)).map(r => {
                const head = /** @type {HTMLElement} */ (r.querySelector('.acct-row-head')).getBoundingClientRect();
                const mail = /** @type {HTMLElement} */ (r.querySelector('.acct-row-email')).getBoundingClientRect();
                const em = /** @type {HTMLElement} */ (r.querySelector('.acct-email'));
                return { oneLine: Math.abs(head.top - mail.top) < 4 && mail.left > head.right && r.getBoundingClientRect().height < 50,
                         whole: em.scrollWidth <= em.clientWidth && em.clientWidth > 0 };
            }), LONG_EMAIL);
        expect(others.length, `${width}: premise: the card lists the roster`).toBeGreaterThan(10);
        // At 1024 the one-line row cannot hold even "No work email" and its button beside a 19rem head
        // (it read "📧 N…"), so each takes the two-line shape — whole, where it was cut.
        expect(others.filter(o => !o.whole).length, `${width}: every other account's line is whole too`).toBe(0);
        // At 1366 every other account is still ONE line — the audit's compact card, unchanged where it fitted.
        if (width === 1366) expect(others.filter(o => !o.oneLine).length, '1366: every account without that address is one line').toBe(0);
    }
});

// ── OPERATIONS: Password Reset Requests card WITH ROWS (v18.94) ────────────────────────────────
// This card shipped at v18.93 rendered only at 1280px, and its row collapsed at 375px — the name
// column squeezed to 18px, names broke mid-word and the text painted over the remedy label. Nothing
// caught it: the page-level overflow guards stay clean (the overflow is inside a flex child), and
// there was no way to render an Operations card with DATA. Hence both: the seeding hook in
// fixtures.js, and this test at the documented primary width.
for (const width of [375, 1280]) {
    test(`operations reset-requests card renders correctly @${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 1000 });
        await page.addInitScript(() => {
            window.__E2E = { docs: [
                { id: 'A. Hared',       requestedAt: Date.now() - 4 * 60_000,    count: 1, provisioned: true },
                { id: 'N. Bedingfield', requestedAt: Date.now() - 26 * 3600_000, count: 1, provisioned: false },
                { id: 'K. Jedlinski',   requestedAt: Date.now() - 90 * 60_000,   count: 4, provisioned: true },
            ] };
        });
        await seedSession(page, 'G. Miller');
        await page.goto('/operations.html');

        const rows = page.locator('.rr-row');
        await expect(rows).toHaveCount(3);
        // The card auto-opens when there is anything to action, and the chip counts it.
        await expect(page.locator('#resetRequestsCountChip')).toHaveText('3');
        await expect(page.locator('.rr-row').first()).toBeVisible();
        // An unprovisioned account needs Set up accounts, not Reset — different remedy, stated.
        await expect(page.locator('.rr-remedy--setup')).toHaveText(/Set up accounts/);
        await expect(page.locator('.rr-row', { hasText: 'K. Jedlinski' })).toContainText('asked 4 times');

        // No row may overflow its own box — the failure mode that shipped. Checked per flex child,
        // because the PAGE reports no overflow when a flex item overflows internally.
        const overflow = await page.locator('.rr-main').evaluateAll(
            els => els.map(el => el.scrollWidth - el.clientWidth));
        expect(overflow, `.rr-main overflow at ${width}px`).toEqual([0, 0, 0]);
        const pageOverflow = await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(pageOverflow).toBeLessThanOrEqual(1);
    });
}

// ── OPERATIONS: the reset-request push deep link (v18.95) ──────────────────────────────────────
// The admin's notification opens operations.html#reset-requests. Operations has nine collapsed
// cards, so landing on the page alone would still leave them hunting for the one it was about.
test('operations #reset-requests deep link opens and scrolls to the queue card', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    // Deliberately seeded EMPTY: with rows the card auto-opens anyway, so an empty queue is the only
    // state that actually proves the deep link — not the auto-open — did the work. (A cleared queue
    // is a real arrival state: the admin taps a notification after already handling it elsewhere.)
    await page.addInitScript(() => { window.__E2E = { docs: [] }; });
    await seedSession(page, 'G. Miller');
    await page.goto('/operations.html#reset-requests');

    const body = page.locator('#resetRequestsBody');
    await expect(body).toHaveClass(/\bopen\b/);
    // The chevron must AGREE with the class — opening by class alone leaves a screen reader told the
    // card is still collapsed (A11Y_BASELINE.md v18.68).
    await expect(page.locator('#resetRequestsChevron')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#resetRequestsCard')).toBeInViewport();
});

test('operations deep link only ever opens — a repeat tap does not close the card', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.addInitScript(() => { window.__E2E = { docs: [] }; });
    await seedSession(page, 'G. Miller');
    await page.goto('/operations.html#reset-requests');
    await expect(page.locator('#resetRequestsBody')).toHaveClass(/\bopen\b/);

    // Tapping the notification while Operations is ALREADY open re-navigates the existing client, so
    // only hashchange fires. A toggle here would close the card the admin was sent to look at.
    await page.evaluate(() => {
        location.hash = '';
        location.hash = '#reset-requests';
    });
    await expect(page.locator('#resetRequestsBody')).toHaveClass(/\bopen\b/);
});

test('operations without the hash leaves the queue card collapsed', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.addInitScript(() => { window.__E2E = { docs: [] }; });
    await seedSession(page, 'G. Miller');
    await page.goto('/operations.html');
    await expect(page.locator('#resetRequestsContent')).toContainText('No outstanding requests');
    await expect(page.locator('#resetRequestsBody')).not.toHaveClass(/\bopen\b/);
});

// A tap on the reset-request notice while Operations is ALREADY open only changes the hash. Until the
// Sep 2026 review that opened the card over the list read at page load — "No outstanding requests"
// beside a notification saying otherwise — and a second tap, the hash unchanged, did nothing at all.
test('operations: a reset-request tap on an OPEN page re-reads the queue, and a second tap still lands', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.addInitScript(() => { /** @type {any} */ (window).__E2E = { docs: [] }; });
    await seedSession(page, 'G. Miller');
    await page.goto('/operations.html');
    await expect(page.locator('#resetRequestsContent')).toContainText('No outstanding requests');

    await page.evaluate(() => {
        /** @type {any} */ (window).__E2E.docs = [{ id: 'A. Hared', requestedAt: Date.now(), count: 1, provisioned: true }];
        location.hash = '#reset-requests';
    });
    await expect(page.locator('.rr-row')).toHaveCount(1);
    // Followed, then stripped — so the next tap is a CHANGE of hash, not a repeat of one.
    await expect.poll(() => page.evaluate(() => location.hash)).toBe('');

    await page.evaluate(() => {
        /** @type {any} */ (window).__E2E.docs.push({ id: 'K. Jedlinski', requestedAt: Date.now(), count: 1, provisioned: true });
        location.hash = '#reset-requests';
    });
    await expect(page.locator('.rr-row')).toHaveCount(2);
});

// REMOVED at v22.37: 'the typed value is not hidden under the Show button'. It measured that the
// New Password field reserved enough padding-right for the `Show` button overlaid on it — a real
// hazard, and one that cannot arise any more, because there is no overlaid button. The reveal is
// now a labelled checkbox BELOW the three fields ('Show passwords reveals all THREE fields' above),
// which is both the accessibility fix and the end of that whole class of collision.

// ── OPERATIONS: exact unique-account sign-in counts on the Usage card (v18.96) ──────────────────
// The counterpart to the device-deduped "active accounts" figure. It comes from a SECOND network
// call (a Cloud Function, not Firestore) appended to a card that already has its data, so the two
// things worth pinning are that it renders, and that its failure can never take the card with it.
for (const width of [375, 1280]) {
    test(`operations usage: sign-in counts render @${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 1200 });
        await page.route('**/getSignInStats', route => route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({ total: 48, last7: 19, last30: 31, neverSignedIn: 6 }),
        }));
        await page.addInitScript(() => { window.__E2E = { authUser: true }; });
        await seedSession(page, 'G. Miller');
        await page.goto('/operations.html');

        const section = page.locator('.usage-signin');
        await expect(section).toContainText('Accounts that have signed in');
        await expect(section).toContainText('31');
        await expect(section).toContainText('19');
        await expect(section).toContainText('6');
        // "staff accounts", never "active accounts" — this card already uses "active" for the
        // device-deduped figure above, and two different numbers must not appear to measure one thing.
        await expect(section).toContainText('48 staff accounts');
        await expect(section).not.toContainText('48 active accounts');

        // No child may overflow its own box — the failure mode the reset-requests row shipped with,
        // which the page-level guard cannot see (the overflow is inside a flex child).
        const overflow = await section.locator('.usage-stat').evaluateAll(
            els => els.map(el => el.scrollWidth - el.clientWidth));
        expect(overflow, `.usage-stat overflow at ${width}px`).toEqual([0, 0, 0]);
        const pageOverflow = await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(pageOverflow).toBeLessThanOrEqual(1);
    });
}

test('operations usage: a failed sign-in-stats call leaves the rest of the card intact', async ({ page }) => {
    // The whole point of appending it detached. A Cloud Function outage must cost the admin this one
    // section, not the page-popularity data and account trend that loaded perfectly well.
    await page.route('**/getSignInStats', route => route.abort());
    await page.addInitScript(() => { window.__E2E = { authUser: true }; });
    await seedSession(page, 'G. Miller');
    await page.goto('/operations.html');

    // The empty wrapper removes itself rather than leaving a stray divider rule.
    await expect(page.locator('.usage-signin')).toHaveCount(0);
    // ASSERTED STRUCTURALLY, NOT ON THE LABEL (v20.08). This read `toContainText('accounts this
    // month')` and broke when that block was renamed — the string was never the subject. `.usage-stats`
    // is emitted by exactly two blocks, the trend one and the sign-in one, so with `.usage-signin`
    // proven absent above, a count of 1 says precisely what this test is about: the section that
    // failed cost us that section and nothing else.
    await expect(page.locator('#usageContent .usage-stats')).toHaveCount(1);
    await expect(page.locator('#usageContent')).toContainText('Page popularity');
    // And no "Couldn't load usage" retry state — the card itself did not fail.
    await expect(page.locator('#usageContent')).not.toContainText('Couldn’t load usage');
});

test('operations usage: the section is absent (not broken) when there is no Firebase user', async ({ page }) => {
    // Default stub state — getSignInStats throws "Not signed in" before it ever fetches. Proves the
    // section degrades the same way whether the call fails or is never made.
    await seedSession(page, 'G. Miller');
    await page.goto('/operations.html');
    await expect(page.locator('#usageContent')).toContainText('Page popularity');
    await expect(page.locator('.usage-signin')).toHaveCount(0);
});

// ── OPERATIONS: the Usage card review's card changes (v25.00) ───────────────────────────────────
/** Open the Usage card on Operations at a phone width, with fixed data. @param {import('@playwright/test').Page} page @param {any} [o] */
async function openUsageCard(page, o = {}) {
    await stubUsageReads(page, o);
    await page.setViewportSize({ width: 375, height: 2400 });
    await seedSession(page, 'G. Miller');
    await page.goto('/operations.html');
    await expect(page.locator('#usageCard')).toBeVisible({ timeout: 10000 });
    await page.evaluate(() => {
        const b = document.getElementById('usageBody');
        if (b && !b.classList.contains('open')) document.getElementById('usageToggleHeader')?.click();
    });
    const card = page.locator('#usageContent');
    await expect(card).toContainText('1,284');
    return card;
}

test('operations usage: every section is a heading one rank under the card, at App Speed\'s sizes', async ({ page }) => {
    // They were <p> labels, so a screen-reader user could not move between the sections of the
    // longest card on the page — and at 12px they sat a step below App Speed's 13px section heads.
    const card = await openUsageCard(page);
    await expect(card.locator('.usage-signin')).not.toHaveAttribute('aria-busy', 'true');
    const h3 = await card.locator('h3').allTextContents();
    expect(h3.map(t => t.replace(/^\P{L}+/u, ''))).toEqual([
        'Roster in use — member-devices', 'Accounts that have signed in', 'Which address staff are on',
        'Page popularity — November 2026']);
    await expect(card.locator('h4')).toHaveText(/Documents & guides — opens/);
    await expect(card.locator('p.usage-section-label')).toHaveCount(0);
    const size = (/** @type {string} */ sel) => card.locator(sel).first().evaluate(el => parseFloat(getComputedStyle(el).fontSize));
    expect(await size('h3')).toBe(13);
    expect(await size('h4')).toBe(12);
    // One divider between two sections, drawn by the heading — never a second one by a wrapper, and
    // never hard against the text above it.
    const gaps = await card.evaluate(root => [...root.querySelectorAll('h3.speed-subhead--rule')].map(h => {
        const prev = /** @type {Element} */ (h.previousElementSibling || h.parentElement?.previousElementSibling);
        return h.getBoundingClientRect().top - prev.getBoundingClientRect().bottom;
    }));
    expect(gaps.length).toBe(3);
    for (const g of gaps) expect(g).toBeGreaterThanOrEqual(16);
    const wrappers = await card.evaluate(root => [...root.querySelectorAll('.usage-signin, .usage-origins')]
        .map(w => getComputedStyle(w).borderTopWidth + ' ' + getComputedStyle(w).borderBottomWidth));
    expect(wrappers).toEqual(['0px 0px', '0px 0px']);
});

test('operations usage: last month\'s figure sits beside this month\'s, named by its month', async ({ page }) => {
    const card = await openUsageCard(page);
    const boxes = card.locator('.usage-stats').first().locator('.usage-stat');
    await expect(boxes).toHaveCount(3);
    await expect(boxes.nth(1)).toHaveText(/29\s*in October/);
    await expect(boxes.nth(1)).toHaveClass(/usage-stat--context/);
    await expect(boxes.nth(2)).toHaveText(/34\s*last 30 days/);
    // No emoji in a box any more — the section heading carries the one.
    expect(await card.locator('.usage-stat-lbl span[aria-hidden]').count()).toBe(0);
});

test('operations usage: with no last month on record, the row is this month and the last 30 days', async ({ page }) => {
    const card = await openUsageCard(page, { usage: usageStats({ monthsHistory: {} }) });
    await expect(card.locator('.usage-stats').first().locator('.usage-stat')).toHaveCount(2);
    await expect(card.locator('.usage-stat--context')).toHaveCount(0);
});

test('operations usage: the installed app is a number per address, and each legend swatch keeps its own label', async ({ page }) => {
    const card = await openUsageCard(page);
    await expect(card.locator('.usage-origin-installed-count'))
        .toHaveText('From the installed app: 9 of 24 on GitHub Pages, 17 of 22 on web.app, 0 of 1 elsewhere');
    const items = card.locator('.usage-origin-legend > .speed-legend-item');
    await expect(items).toHaveCount(2);
    for (const i of [0, 1]) await expect(items.nth(i).locator('.usage-origin-key')).toHaveCount(1);
    // The swatch sits nearer its own words than the previous item's — the pairing the loose siblings lost.
    const [own, toPrev] = await card.locator('.usage-origin-legend').evaluate(lg => {
        const [a, b] = [...lg.querySelectorAll('.speed-legend-item')];
        const key = /** @type {Element} */ (b.querySelector('.usage-origin-key')).getBoundingClientRect();
        const r = document.createRange(); r.selectNodeContents(b); r.setStartAfter(/** @type {Node} */ (b.firstChild));
        return [r.getBoundingClientRect().left - key.right, a.getBoundingClientRect().top === b.getBoundingClientRect().top
            ? key.left - a.getBoundingClientRect().right : Infinity];
    });
    expect(own).toBeLessThan(toPrev);
});

test('operations usage: the sign-in section holds its place while the figures load', async ({ page }) => {
    // It used to arrive a second or more after the rest of the card, ABOVE two sections the admin may
    // already be reading, and push them down the screen.
    const card = await openUsageCard(page, { holdSignIn: true });
    const signin = card.locator('.usage-signin');
    await expect(signin).toHaveAttribute('aria-busy', 'true');
    await expect(signin.locator('.usage-stat-num')).toHaveText(['—', '—', '—']);
    const before = await card.locator('.usage-origins h3').boundingBox();
    await page.evaluate(() => /** @type {any} */ (window).__landSignIn());
    await expect(signin).not.toHaveAttribute('aria-busy', 'true');
    await expect(signin.locator('.usage-stat-num')).toHaveText(['28', '19', '5']);
    await expect(signin).toContainText('41 staff accounts');
    const after = await card.locator('.usage-origins h3').boundingBox();
    expect(Math.abs((after?.y ?? 0) - (before?.y ?? 0))).toBeLessThanOrEqual(1);
});

test('operations usage: the release-reload note names the months it qualifies and retires itself', async ({ page }) => {
    // November is counted the new way; October (the month the reload stopped counting) the old way.
    const card = await openUsageCard(page);
    await expect(card).not.toContainText('Until late October 2026');
    await card.locator('.speed-toggle-btn', { hasText: 'Last month' }).click();
    await expect(card.locator('h3').last()).toHaveText(/October 2026/);
    await expect(card).toContainText('Until late October 2026 this also counted the reload');
});

// ── Reset requests: a Clear during an in-flight load must not leave a ghost (v18.97) ────────────
// v18.94 stopped two Clears racing by DROPPING a refresh requested mid-load. That fixed the ordering
// but left a subtler ghost (external review): clear A → refresh A starts → clear B → refresh B is
// discarded → A's snapshot, taken before B was deleted, repaints B, and nothing is queued to correct
// it. The fixture delays reads so the interleaving is reproducible rather than a matter of luck, and
// deleteDoc now really removes the row so a ghost and a correctly-cleared row look different.
test('operations reset requests: clearing two rows quickly leaves neither behind', async ({ page }) => {
    await page.addInitScript(() => {
        window.__E2E = {
            docsDelayMs: 400,        // hold every read open long enough to overlap the second Clear
            docs: [
                { id: 'A. Hared',     requestedAt: Date.now() - 60_000, count: 1, provisioned: true },
                { id: 'K. Jedlinski', requestedAt: Date.now() - 90_000, count: 1, provisioned: true },
            ],
        };
    });
    await seedSession(page, 'G. Miller');
    await page.goto('/operations.html');
    await expect(page.locator('.rr-row')).toHaveCount(2);

    // Two Clears in quick succession — the second lands while the first's refresh is still open.
    //
    // The FIRST is a real click, which is what proves the button is genuinely clickable. The SECOND
    // is dispatched in-page, and that is not a shortcut: the card re-renders while the delayed reads
    // land, so a driven click spends its budget on Playwright's actionability wait — "element is not
    // stable", then "detached from the DOM, retrying" — and on WebKit under CI load it never lands
    // at all, timing out at 30s having never exercised the concurrency this test exists for. Keyed
    // by `data-member` rather than by index, because after the first Clear the indices have moved.
    await page.locator('.btn-rr-clear[data-member="A. Hared"]').click();
    await page.evaluate(() => {
        /** @type {HTMLButtonElement|null} */
        (document.querySelector('.btn-rr-clear[data-member="K. Jedlinski"]'))?.click();
    });

    // Both deletes happened, so the card must end up empty. With the dropped-refresh behaviour the
    // second row survives as a ghost with no pending load to remove it.
    await expect(page.locator('#resetRequestsContent')).toContainText('No outstanding requests', { timeout: 10_000 });
    await expect(page.locator('.rr-row')).toHaveCount(0);
    // The chip must agree — a stale count over an empty list is the v18.94 lesson.
    await expect(page.locator('#resetRequestsCountChip')).toHaveText('');
});

// ── A Clear that fails SAYS so, and one whose outcome is unknown says THAT (Oct 2026 review) ──────
// clearResetRequest is a gated write: a delete abandoned at sign-out may still land, and the gate
// refuses the next write until reload. Before this the row silently re-enabled its button, so the
// admin pressed Clear again and was refused with nothing on screen to say why.
for (const [code, line, staysOff] of [
    ['unavailable', /Couldn.t clear — check your connection/, false],
    ['auth/signed-out-during-request', /signed out before this clear was confirmed/, true],
]) {
    test(`operations reset requests: a failed Clear (${code}) is reported in its row`, async ({ page }) => {
        await page.addInitScript((c) => {
            window.__E2E = {
                failDeleteCode: c,
                docs: [
                    { id: 'A. Hared',     requestedAt: Date.now() - 60_000, count: 1, provisioned: true },
                    { id: 'K. Jedlinski', requestedAt: Date.now() - 90_000, count: 1, provisioned: true },
                ],
            };
        }, code);
        await seedSession(page, 'G. Miller');
        await page.goto('/operations.html');
        const btn = page.locator('.btn-rr-clear[data-member="A. Hared"]');
        await btn.click();
        await expect(page.locator('.rr-row .rr-error')).toHaveText(line);
        await expect(page.locator('.rr-row')).toHaveCount(2);
        if (staysOff) await expect(btn).toBeDisabled();
        else await expect(btn).toBeEnabled();
        if (!staysOff) return;
        // THE GATE: after an unknown outcome the next write is refused before it is sent — which
        // is what proves the delete went through writeWithClaimRetry and not the ungated retry.
        await page.evaluate(() => { window.__E2E.failDeleteCode = null; });
        await page.locator('.btn-rr-clear[data-member="K. Jedlinski"]').click();
        await expect(page.locator('.rr-row .rr-error').nth(1)).toHaveText(/earlier change on this page was not confirmed/);
        await expect(page.locator('.rr-row')).toHaveCount(2);
    });
}

// ── THE WORK-EMAIL SAVE AND REMOVE SAY WHICH KIND OF FAILURE (v25.06, whole-app review) ─────────
// Both go through writeWithClaimRetry, but their error handling ignored an UNKNOWN outcome: Save said
// "check your connection" and re-armed (the gate then refused every later write, still blaming the
// connection), and Remove failed silently — the button simply came back.
for (const [code, line, staysOff] of [
    ['unavailable', /Couldn.t save — check your connection/, false],
    ['auth/signed-out-during-request', /signed out before this save was confirmed/, true],
]) {
    test(`operations account status: a failed work-email Save (${code}) says which kind`, async ({ page }) => {
        await page.addInitScript((c) => {
            const w = /** @type {any} */ (window);
            w.__E2E = { authUser: true, failSetCode: c, docs: [], docsByPath: { staffContact: [], passwordStatus: [], resetRequests: [] } };
        }, code);
        await seedSession(page, 'G. Miller');
        await page.goto('/operations.html');
        await page.evaluate(() => document.getElementById('accountStatusBody')?.classList.add('open'));
        const row = page.locator('.acct-row').first();
        await row.locator('.email-set-btn').first().click();
        await row.locator('.email-set-form input').fill('test.person@chilternrailways.co.uk');
        await row.locator('.email-set-save').click();
        await expect(row.locator('.email-set-error')).toHaveText(line);
        if (staysOff) await expect(row.locator('.email-set-save')).toBeDisabled();
        else await expect(row.locator('.email-set-save')).toBeEnabled();
    });
}

test('operations account status: a work-email Remove of unknown outcome says so, and stays off', async ({ page }) => {
    await page.addInitScript(() => {
        const w = /** @type {any} */ (window);
        w.__E2E = { authUser: true, failDeleteCode: 'auth/signed-out-during-request', docs: [],
            docsByPath: { staffContact: [{ id: 'A. Hared', memberName: 'A. Hared', workEmail: 'a.hared@chilternrailways.co.uk' }], passwordStatus: [], resetRequests: [] } };
    });
    await seedSession(page, 'G. Miller');
    await page.goto('/operations.html');
    await page.evaluate(() => document.getElementById('accountStatusBody')?.classList.add('open'));
    const remove = page.locator('.email-set-btn--remove').first();
    await remove.click();          // arms ("Confirm?")
    await remove.click();          // removes
    await expect(page.locator('.acct-row .email-set-error').first()).toHaveText(/signed out before this removal was confirmed/);
    await expect(remove).toBeDisabled();
});

test('operations account status: a failed Remove leaves the open edit form its own error line', async ({ page }) => {
    // 48-hour review, Nov 2026. The Remove failure cleared the FIRST error line in the row — with the
    // edit form open, that was the form's — so the form's own save failure then wrote to a detached
    // element and the admin saw nothing at all.
    await page.addInitScript(() => {
        const w = /** @type {any} */ (window);
        w.__E2E = { authUser: true, failDeleteCode: 'unavailable', failSetCode: 'unavailable', docs: [],
            docsByPath: { staffContact: [{ id: 'A. Hared', memberName: 'A. Hared', workEmail: 'a.hared@chilternrailways.co.uk' }], passwordStatus: [], resetRequests: [] } };
    });
    await seedSession(page, 'G. Miller');
    await page.goto('/operations.html');
    await page.evaluate(() => document.getElementById('accountStatusBody')?.classList.add('open'));
    const row = page.locator('.acct-row').filter({ has: page.locator('.email-set-btn--remove') }).first();
    await row.locator('.email-set-btn:not(.email-set-btn--remove)').click();   // Edit: the form opens
    await expect(row.locator('.email-set-form')).toBeVisible();
    const remove = row.locator('.email-set-btn--remove');
    await remove.click();
    await remove.click();                                                       // the Remove fails
    await expect(row.locator('.email-set-error').last()).toHaveText(/Couldn’t remove/);
    await row.locator('.email-set-save').click();                               // and the form's save fails
    await expect(row.locator('.email-set-form .email-set-error')).toHaveText(/Couldn't save/);
});

test('operations reset requests: a Clear that fails AFTER the list was redrawn reports on the row now shown', async ({ page }) => {
    // The list re-renders on a notification tap (#reset-requests) or a queued reload. The failure
    // used to be appended to the row that had been replaced — off the page, so nobody saw it.
    await page.addInitScript(() => {
        window.__E2E = {
            failDeleteCode: 'auth/signed-out-during-request', deleteDelayMs: 800,
            docs: [{ id: 'A. Hared', requestedAt: Date.now() - 60_000, count: 1, provisioned: true }],
        };
    });
    await seedSession(page, 'G. Miller');
    await page.goto('/operations.html');
    await page.locator('.btn-rr-clear[data-member="A. Hared"]').click();
    await page.evaluate(() => { location.hash = '#reset-requests'; });   // the redraw, mid-delete
    await expect(page.locator('.rr-row .rr-error')).toHaveText(/signed out before this clear was confirmed/);
    await expect(page.locator('.btn-rr-clear[data-member="A. Hared"]'), 'an unknown outcome keeps Clear off on the live row too').toBeDisabled();
});

// ── The Needs-attention strip must not survive its own card (v23.36) ────────────────────────────
// `operations-attention.js`'s whole design is that the strip CANNOT disagree with the card it
// points at: it runs no reads, and every count arrives from the card that owns the data. The Error
// Log broke that by re-invoking itself twice — the resolve-all refresh and the retry button — with
// the `onAttention` callback dropped, so the refreshed render set the header chip correctly and
// told the strip nothing.
//
// Both directions are asserted because they cost different things. A stale count after a
// resolve-all is visible nonsense the admin can reload away. The retry case is the expensive one
// and is silent: a failed load reports nothing (correctly — unknown is not zero), so after a
// successful retry the strip does not exist AT ALL over a card listing errors, which is the page's
// own index of what needs doing stating that nothing does.
//
// This is the only level that can see it — `operations-attention.js`'s unit tests are of the pure
// decision, and it was never the decision that was wrong.
const ATTN_ERRS = [
    { id: 'e1', memberName: 'A. Hared', page: 'calendar', message: 'boom one', appVersion: '23.36', resolved: false, timestamp: Date.now() - 60_000 },
];

test('operations attention: resolving every error clears the strip, not just the chip', async ({ page }) => {
    await page.addInitScript((rows) => {
        const w = /** @type {any} */ (window);
        w.__E2E = { authUser: true, docs: rows };
    }, ATTN_ERRS);
    await seedSession(page, 'G. Miller');
    await page.goto('/operations.html#error-log');

    const strip = page.locator('#attentionStrip');
    await expect(strip).toContainText('Unresolved errors');
    // Both queries in getClientErrors read the same seeded rows, so the card shows two.
    await expect(page.locator('#errorLogCountChip')).toHaveText('2');

    // What the in-place refresh will read back: the server now has nothing.
    await page.evaluate(() => { /** @type {any} */ (window).__E2E.docs = []; });
    await page.locator('.error-resolve-all-btn').click();

    await expect(page.locator('#errorLogContent')).toContainText('No errors recorded');
    await expect(page.locator('#errorLogCountChip')).toHaveText('');
    // The chip and the strip are two voices for one fact. With `opts` dropped the strip kept
    // "Unresolved errors 2" over a card saying there are none.
    await expect(strip).not.toContainText('Unresolved errors');
});

test('operations attention: a refresh that FAILS withdraws the strip item, as it clears the chip (v25.06)', async ({ page }) => {
    await page.addInitScript((rows) => {
        const w = /** @type {any} */ (window);
        w.__E2E = { authUser: true, docs: rows };
    }, ATTN_ERRS);
    await seedSession(page, 'G. Miller');
    await page.goto('/operations.html#error-log');
    const strip = page.locator('#attentionStrip');
    await expect(strip).toContainText('Unresolved errors');
    // Resolve-all succeeds… and the in-place refresh that follows cannot read.
    await page.evaluate(() => { /** @type {any} */ (window).__E2E.failGetDocs = true; });
    await page.locator('.error-resolve-all-btn').click();
    await expect(page.locator('#errorLogContent')).toContainText("Couldn't load error log");
    await expect(page.locator('#errorLogCountChip')).toHaveText('');
    await expect(strip, 'an unknown count is not still "2 unresolved errors" above a failed panel').not.toContainText('Unresolved errors');
});

test('operations attention: a retry after a failed load still reaches the strip', async ({ page }) => {
    await page.addInitScript((rows) => {
        const w = /** @type {any} */ (window);
        w.__E2E = { authUser: true, docs: rows, failGetDocs: true };
    }, ATTN_ERRS);
    await seedSession(page, 'G. Miller');
    await page.goto('/operations.html#error-log');

    // A failed read reports NOTHING rather than a reassuring zero, so the strip has no error item.
    await expect(page.locator('#errorLogContent')).toContainText("Couldn't load error log");
    await expect(page.locator('#attentionStrip')).not.toContainText('Unresolved errors');

    await page.evaluate(() => { /** @type {any} */ (window).__E2E.failGetDocs = false; });
    await page.locator('#errorLogContent .card-retry-btn').click();

    await expect(page.locator('#errorLogCountChip')).toHaveText('2');
    // The false all-clear: the card lists errors and the strip did not exist at all.
    await expect(page.locator('#attentionStrip')).toContainText('Unresolved errors');
});

// ── A REFUSED RESET SAYS WHY, AND OFFERS NO RETRY (whole-app review, Oct 2026) ──────────────────
// A 404 "run Set up accounts first", a 409 "linked to the shared PIN" or a 403 all became a bare
// "Retry" that could never succeed, with the server's sentence only in the console.
test('operations: a refused reset names the server\'s reason and offers no Retry', async ({ page }) => {
    await page.addInitScript(() => {
        const w = /** @type {any} */ (window);
        w.__E2E = { authUser: true, docs: [], docsByPath: { staffContact: [], passwordStatus: [], resetRequests: [] } };
    });
    await page.route('**/resetMemberPassword', route => route.fulfill({
        status: 404, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({ error: 'No Firebase account for "B. Toth" — run Set up accounts first' }),
    }));
    await seedSession(page, 'G. Miller');
    await page.goto('/operations.html');
    await page.evaluate(() => document.getElementById('accountStatusBody')?.classList.add('open'));
    const row = page.locator('.acct-row').first();
    await row.locator('.btn-acct-reset').click();
    await page.locator('.dialog-btn-confirm').click();
    const dialog = page.locator('.lb-overlay.open');
    await expect(dialog).toContainText('The reset was refused');
    await expect(dialog).toContainText('run Set up accounts first');
    await expect(row.locator('.btn-acct-reset')).toHaveText('Reset');
});

// A FULLY SUCCESSFUL RESET SAYS SO (whole-app review, Oct 2026). The row re-renders, and a member
// already on the default looks exactly as before — so a reset that worked gave no sign it had run.
test('operations: a fully successful reset leaves a receipt on the row', async ({ page }) => {
    await page.addInitScript(() => {
        const w = /** @type {any} */ (window);
        w.__E2E = { authUser: true, docs: [], docsByPath: { staffContact: [], passwordStatus: [], resetRequests: [] } };
    });
    await page.route('**/resetMemberPassword', route => route.fulfill({
        status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({ revoked: true, stamped: true, notified: true }),
    }));
    await seedSession(page, 'G. Miller');
    await page.goto('/operations.html');
    await page.evaluate(() => document.getElementById('accountStatusBody')?.classList.add('open'));
    const row = page.locator('.acct-row').first();
    await row.locator('.btn-acct-reset').click();
    await page.locator('.dialog-btn-confirm').click();
    await expect(row.locator('.btn-acct-reset')).toHaveText('Reset ✓');
});

// ── A reset that timed out did not necessarily fail (v23.36) ────────────────────────────────────
// `fetch-timeout.js`'s header names `resetMemberPassword` when it says a timeout on a write must
// never be reported as "that failed" — the abort stops us waiting, not the server working. The
// admin who is told the reset failed goes and tells the member their old password still works,
// when their account may already be on the surname default with their other sessions revoked.
//
// Only a browser can see this: the message is composed in firebase-client.js (and was correct
// throughout), and the defect was the coordinator discarding it into a console warning.
test('operations: a reset whose server never answers is not reported as a failure', async ({ page }) => {
    await page.clock.install();
    await page.addInitScript(() => {
        const w = /** @type {any} */ (window);
        w.__E2E = { authUser: true, docs: [], docsByPath: { staffContact: [], passwordStatus: [], resetRequests: [] } };
    });
    // The request leaves and never comes back — the stalled transport the bound exists for.
    await page.route('**/resetMemberPassword', () => { /* never fulfilled */ });
    await seedSession(page, 'G. Miller');
    await page.goto('/operations.html');
    await page.clock.runFor(3000);
    await page.evaluate(() => document.getElementById('accountStatusBody')?.classList.add('open'));

    const row = page.locator('.acct-row').first();
    const name = await row.getAttribute('data-member');
    await row.locator('.btn-acct-reset').click();
    await page.locator('.dialog-btn-confirm').click();
    await page.clock.runFor(1000);
    await expect(row.locator('.btn-acct-reset')).toHaveText('Resetting…');

    // Past the client's own 65s budget (above the endpoint's 60s ceiling — fetch-timeout.js).
    await page.clock.runFor(70_000);

    // It SAYS it could not confirm, and tells the admin where to look.
    const dialog = page.locator('.lb-overlay.open');
    await expect(dialog).toContainText('Couldn’t confirm the reset');
    await expect(dialog).toContainText(String(name));
    await expect(dialog).toContainText('may still have gone through');
    // …and the button does not describe an outcome nobody knows. "Retry" is the failure
    // affordance and belongs only to a request that provably did not land.
    await expect(row.locator('.btn-acct-reset')).toHaveText('Reset');
    await expect(row.locator('.btn-acct-reset')).not.toHaveText('Retry');
});

// ── A tab left open past midnight can still pick today (v23.36) ─────────────────────────────────
// `doc-upload.js` recomputes its date cap at init and on submit — the v16.23 stale-tab fix, written
// before this picker existed. `date-picker.js` reads `min`/`max` at OPEN time, so an Operations tab
// left open overnight offered a grid whose real today was `dp-off`: the admin could not choose it,
// and the only escape was a reload. Measured, not reasoned — a screenshot cannot see `dp-off`.
test('operations: the date picker follows the clock across midnight', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-09-08T21:00:00Z') });
    await page.addInitScript(() => { /** @type {any} */ (window).__E2E = { authUser: true, docs: [] }; });
    await seedSession(page, 'G. Miller');
    await page.goto('/operations.html');
    await page.clock.runFor(2000);
    await page.evaluate(() => document.getElementById('circularUploadBody')?.classList.add('open'));

    const trigger = page.locator('#circularUploadBody .date-trigger');
    await expect(trigger).toHaveText(/8 Sep 2026/);

    // The tab just sits there while the day turns over.
    await page.clock.setFixedTime(new Date('2026-09-09T09:00:00Z'));
    await trigger.click();

    const ninth = page.locator('.dp-day[data-iso="2026-09-09"]');
    await expect(ninth).toBeVisible();
    // The real today is selectable. Without the refresh it carried `dp-off` + aria-disabled,
    // pinned against yesterday's `max`.
    await expect(ninth).not.toHaveClass(/dp-off/);
    await expect(ninth).not.toHaveAttribute('aria-disabled', 'true');
    await ninth.click();
    await expect(trigger).toHaveText(/9 Sep 2026/);
});

// ── The week the roster form offers first (owner, 10 Nov 2026; import-client-3) ─────────────────
// The rule is unit-tested (admin-roster-upload.test.mjs → defaultWeekEnding). This is the wiring: on
// a Thursday — the day the final roster is released — the form offers the FOLLOWING week.
test('operations: on a Thursday the roster form offers the following week', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-11-12T10:00:00Z') });
    await page.addInitScript(() => { /** @type {any} */ (window).__E2E = { authUser: true, docs: [] }; });
    await seedSession(page, 'G. Miller');
    await page.goto('/operations.html');
    await page.clock.runFor(2000);
    await expect(page.locator('#rosterWeekEnding')).toHaveValue('2026-11-21');
    await page.evaluate(() => document.getElementById('rosterUploadBody')?.classList.add('open'));
    await expect(page.locator('#rosterUploadBody .date-trigger')).toHaveText(/Sat 21 Nov 2026/);
});

// ── The app's own dropdown on Operations (v23.38) ──────────────────────────────────────────────
// select-sheet-parity.test.mjs proves the RULE — that every select is enhanced or declared native.
// It cannot prove the enhancement WORKS, and "the rule tested, the wiring not" is this repo's named
// blind spot. What only a browser answers is that the trigger opens the sheet, that a pick moves the
// value the consumer reads (`rosterTypeEl.value` in admin-roster-upload.js), and that the native
// select is still in the DOM holding it — both halves of progressive enhancement at once.
test('operations: the roster type is picked from the app\'s own sheet, and the pick reaches the select', async ({ page }) => {
    await page.addInitScript(() => { /** @type {any} */ (window).__E2E = { authUser: true, docs: [] }; });
    await seedSession(page, 'G. Miller');
    await page.goto('/operations.html');
    await page.evaluate(() => document.getElementById('rosterUploadBody')?.classList.add('open'));

    const trigger = page.locator('#rosterTypeTrigger');
    // The FACE, not the button. Since v23.39 the trigger also carries `.fieldpick-sizer`, a hidden
    // copy of the widest option that stops the control resizing when its value changes — so the
    // button's own text is the label TWICE ("CEA / BilingualCEA / Bilingual"). Reading the face is
    // also the honest assertion: it is the span a member actually sees.
    const face = page.locator('#rosterTypeTrigger .fieldpick-face');
    await expect(trigger).toBeVisible();
    await expect(face).toHaveText('CEA / Bilingual');
    // The value holder is still here, and out of the a11y tree — otherwise a screen reader would
    // find two controls for one value, one of them unreachable.
    await expect(page.locator('#rosterType')).toHaveAttribute('aria-hidden', 'true');

    await trigger.click();
    const sheet = page.locator('.picker-sheet');
    await expect(sheet).toBeVisible();
    await sheet.locator('.picker-opt', { hasText: 'Dispatchers' }).click();

    await expect(face).toHaveText('Dispatchers');
    await expect(page.locator('#rosterType')).toHaveValue('dispatcher');
});

test('operations: the account-status grade filter is enhanced too, and keeps focus somewhere visible', async ({ page }) => {
    // This one is built at RUNTIME, after the card's read returns, and its card rebuilds itself on
    // every reload — so the enhancement has to happen at construction rather than at page init.
    // The focus half is the reason the test exists: `filterSelect.focus()` was correct until the
    // enhancement made the select 1px and `aria-hidden`, at which point focusing it would send a
    // keyboard user off the visible page with nothing to say where they went.
    await page.addInitScript(() => { /** @type {any} */ (window).__E2E = { authUser: true, docs: [] }; });
    await seedSession(page, 'G. Miller');
    await page.goto('/operations.html');
    await page.evaluate(() => document.getElementById('accountStatusBody')?.classList.add('open'));

    const trigger = page.locator('#acctGradeFilterTrigger');
    const face = page.locator('#acctGradeFilterTrigger .fieldpick-face');   // see the sizer note above
    await expect(trigger).toBeVisible();
    await expect(face).toHaveText('All grades');

    await trigger.click();
    await page.locator('.picker-sheet .picker-opt', { hasText: /^CES$/ }).click();
    await expect(face).toHaveText('CES');
    await expect(page.locator('#acctGradeFilter')).toHaveValue('CES');

    // The trigger is a real Tab stop; the select it stands in front of deliberately is not.
    await expect(trigger).toHaveAttribute('type', 'button');
    await expect(page.locator('#acctGradeFilter')).toHaveAttribute('tabindex', '-1');
    await trigger.focus();
    await expect(trigger).toBeFocused();
});

// ── Roster review: a state's marker must reach EVERY row type (v24.02, CI-gated) ──────────────
//
// Both halves of this were shipped broken at v24.00 and neither the a11y gate nor the visual
// baseline could see it, because BOTH were written against a fixture whose conflict values happen
// to be TIMES and whose rows happen to be DIFF.
//
//   1. `.cv-dim` marks the option a conflict row will NOT apply. It was changed from a fade to
//      `text-decoration: line-through` — which does not inherit into an atomic inline box, and
//      `.shift-badge` is `display: inline-flex`. A time is a plain span and gets struck; a BADGE
//      (Rest, AL, Spare, an Other flavour with no time) did not, so the two options on the one
//      control that exists to tell them apart rendered identically.
//   2. A set-aside row recedes onto the sunken surface. That was three declarations, each beside
//      the state it described, and all three lost the cascade to `.roster-change-conflict` and
//      `.roster-change-unreadable` — same specificity, declared later. Measured in a refused read:
//      the conflict row came out LIGHTER than the rows that did recede.
//
// So this asserts the marker against every row type the table can produce, not against one.
test('operations: a not-chosen conflict value is struck through, badge or time', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await seedSession(page, 'G. Miller');
    // A conflict whose new-roster value is a BADGE with no time — the case the other fixtures miss.
    await openRosterReview(page, {
        weekEnding: '2026-08-08', rosterType: 'cea', dates: ROSTER_REVIEW_DATES,
        parsed: [{ memberName: 'G. Miller', shifts: { '2026-08-04': 'AL', '2026-08-03': '06:00-14:00' } }],
    });
    const dim = page.locator('.cv-dim').first();
    await expect(dim).toBeVisible();
    await expect(dim.locator('.shift-badge')).toHaveCount(1);   // the fixture really is badge-only
    const struck = await page.evaluate(() => {
        const d = /** @type {Element} */ (document.querySelector('.cv-dim'));
        const b = d.querySelector('.shift-badge');
        return { row: getComputedStyle(d).textDecorationLine, badge: b && getComputedStyle(b).textDecorationLine };
    });
    expect(struck.row, 'the not-chosen row must be struck').toContain('line-through');
    expect(struck.badge, 'and the strike must REACH the badge — it does not inherit into inline-flex')
        .toContain('line-through');
});

test('operations: every row type recedes when it is set aside', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await seedSession(page, 'G. Miller');
    // A refused read un-ticks everything, so all five row types are set aside at once — DIFF,
    // CONFLICT (the seeded manual override) and UNREADABLE all present in one capture.
    await openRosterReview(page, {
        weekEnding: '2026-08-08', rosterType: 'cea', dates: ROSTER_REVIEW_DATES,
        geometryRefused: ['G. Miller', 'L. Springer', 'A. Hared'],
        parsed: [
            { memberName: 'G. Miller',   shifts: { '2026-08-03': '06:00-14:00', '2026-08-04': '13:00-21:00', '2026-08-05': 'UNKNOWN|XZ9' } },
            { memberName: 'L. Springer', shifts: { '2026-08-03': 'RD' } },
            { memberName: 'A. Hared',    shifts: { '2026-08-06': 'SPARE' } },
        ],
    });
    await expect(page.locator('.roster-blocked').first()).toBeVisible();
    // Sentinel: the fixture must actually produce the two row types that lost the cascade.
    await expect(page.locator('.roster-change-conflict')).not.toHaveCount(0);
    await expect(page.locator('.roster-change-unreadable')).not.toHaveCount(0);

    const rows = await page.evaluate(() => [...document.querySelectorAll('.roster-change-row')].map(r => ({
        kind: r.classList.contains('roster-change-conflict') ? 'conflict'
            : r.classList.contains('roster-change-unreadable') ? 'unreadable' : 'plain',
        bg: getComputedStyle(r).backgroundColor,
    })));
    const kinds = [...new Set(rows.map(r => r.kind))].sort();
    expect(kinds, 'the fixture must cover all three row shapes').toEqual(['conflict', 'plain', 'unreadable']);
    const backgrounds = [...new Set(rows.map(r => r.bg))];
    expect(backgrounds,
        'a set-aside row recedes onto ONE surface whatever type it is — a conflict or unreadable row '
        + 'keeping its own tint here is the v24.00 cascade bug:\n  ' + JSON.stringify(rows))
        .toHaveLength(1);
});

// ── Roster review: resolving a flagged cell (v19.32, CI-gated) ────────────────────────────────
// The visual baseline covers this table's COMPOSITION but is opt-in and not a CI gate, so the
// feature's WIRING is asserted here where every branch runs it. What only a real browser proves is
// that the pick reaches the save collector — the rules themselves are unit-tested in
// admin-roster-upload.test.mjs, and duplicating them here would be a second, weaker copy.
// v24.39 (external review): a sign-out while the FIRST batch waits used to be read as "nothing
// committed", leaving the review open to apply again with fresh ids beside a batch that may still
// land. It is ambiguous, so the review closes as a partial one does.
test('operations: a roster apply signed out mid-save closes the review rather than inviting a second copy', async ({ page }) => {
    await page.addInitScript(() => { window.__E2E = { ...(window.__E2E || {}), authUser: true, holdCommits: true }; });
    await seedSession(page, 'G. Miller');
    await openRosterReview(page);
    await page.locator('#rosterApplyBtn').click();
    await page.evaluate(() => /** @type {any} */ (window).__E2E.revokeAuth());
    await expect(page.locator('#rosterApplyFeedback')).toContainText('signed out before this roster was confirmed', { timeout: 5000 });
    await expect(page.locator('#rosterReviewSection')).not.toHaveClass(/visible/);
});

// Whole-app fix, Nov 2026 (import-client-1): while a save waited for the server, any touch in the
// review ran the outcome refresh, which handed the Save button back — and a second press wrote a
// second copy of every row, because the import mints new document ids. The review is now out of
// reach until the save settles, and nothing re-arms the button meanwhile.
test('operations: a roster save still sending keeps its button, whatever is touched meanwhile', async ({ page }) => {
    await page.addInitScript(() => { window.__E2E = { ...(window.__E2E || {}), authUser: true, holdCommits: true }; });
    await seedSession(page, 'G. Miller');
    await openRosterReview(page);
    const save = page.locator('#rosterApplyBtn');
    await expect(save).toHaveText(/Save 3 changes/);
    await save.click();
    await expect(save).toHaveText(/Saving 3 changes/);
    await expect(save).toBeDisabled();
    // Out of reach while it sends: the review, and the two buttons that would start another one.
    await expect(page.locator('#rosterChangeList')).toHaveJSProperty('inert', true);
    await expect(page.locator('#rosterCancelBtn')).toBeDisabled();
    await expect(page.locator('#rosterParseBtn')).toBeDisabled();
    await expect(page.locator('#rosterFileInput')).toBeDisabled();
    // A change that DOES reach the review's handler — a script's click, which `inert` does not stop —
    // still does not give the button back.
    await page.evaluate(() => { const t = /** @type {HTMLElement} */ (document.querySelector('.roster-tick')); t.click(); t.click(); });
    await expect(save).toBeDisabled();
    await expect(save).toHaveText(/Saving 3 changes/);
    await save.click({ force: true });
    await page.evaluate(() => /** @type {any} */ (window).__E2E.releaseCommits());
    await expect(page.locator('#rosterApplyFeedback')).toContainText('Done — 3 changes applied');
    expect(await page.evaluate(() => (/** @type {any} */ (window).__E2E.batchWrites || []).length),
        'one save, so one copy of each row').toBe(3);
    await expect(page.locator('#rosterChangeList')).toHaveJSProperty('inert', false);
});

// Whole-app review, Oct 2026: a pre-v24.48 duplicate manual record outranks an import, so "Use new
// roster" — which deleted only the record the review showed — left the copy to resurface over it.
test('operations: "Use new roster" also clears an older manual copy of the day', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await seedSession(page, 'G. Miller');
    await openRosterReview(page, null, { extraDocs: [{ id: 'm0', memberName: 'G. Miller', date: '2026-08-04',
        value: '22:00-06:00', type: 'shift', source: 'manual' }] });
    await page.locator('.roster-choice-btn[data-pick="pdf"]').first().click();
    await page.locator('#rosterApplyBtn').click();
    await expect.poll(() => page.evaluate(() => (/** @type {any} */ (window).__E2E.batchDeletes || [])
        .filter((/** @type {string} */ p) => /\/m[01]$/.test(p)).map((/** @type {string} */ p) => p.slice(-2)).sort()),
        { timeout: 10_000 }).toEqual(['m0', 'm1']);
    // …and the receipt SAYS so, as Admin's delete does — a removal nobody is told about is silent (48-hour review).
    await expect(page.locator('#rosterApplyFeedback')).toContainText('1 older copy of the same day also removed');
});

test('operations: a flagged roster cell can be resolved from the review table', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await seedSession(page, 'G. Miller');
    await openRosterReview(page);

    const saveBtn = page.locator('#rosterApplyBtn');
    // Three DIFF rows are pre-ticked. The two flagged rows start unresolved and must contribute
    // NOTHING — the pre-v19.32 behaviour is what you get by leaving them alone.
    await expect(saveBtn).toHaveText(/Save 3 changes/);
    await expect(page.locator('.roster-pick')).toHaveCount(3);   // 1 conflict + 2 flagged

    // A garbled cell has no readings to offer, so it stays a skip-only row — the picker must not
    // appear just because a cell was flagged.
    await expect(page.locator('.roster-change-row:not(:has(.roster-pick)) .act-read')).toHaveCount(1);
    // …but UNTIL ANSWERED all three wear the same "couldn't read" chip (polish round 2): the words
    // were always identical, and the two rows offering readings used to wear the decision style.
    await expect(page.locator('.roster-change-row .act-read')).toHaveCount(3);
    await expect(page.locator('.roster-change-unreadable .act-choice')).toHaveCount(0);

    // A flagged row sitting over a MANUAL entry must SHOW it (v19.37). Picking writes with
    // replaceId, so the manual entry is replaced — and this table's standing guarantee is that a
    // hand-recorded entry is never overwritten without the admin seeing it. The fixture puts a
    // manual AL under the Thursday row for exactly this.
    const overManual = page.locator('.roster-change-row')
        .filter({ has: page.locator('.roster-choice-btn[data-opt="0"]') })
        .filter({ hasText: 'Saved' });
    await expect(overManual, 'the flagged row over a manual entry names what it would replace').toHaveCount(1);
    await expect(overManual).toContainText('AL');

    // Picking a reading makes it a change to save…
    const flagged = page.locator('.roster-change-row').filter({ has: page.locator('.roster-choice-btn[data-opt="0"]') });
    await flagged.last().locator('.roster-choice-btn[data-opt="0"]').click();
    await expect(saveBtn).toHaveText(/Save 4 changes/);
    // …and its chip becomes the decision, in place (the pick patches the row, it does not re-render).
    await expect(flagged.last().locator('.roster-act')).toHaveClass(/act-choice/);
    await expect(flagged.last().locator('.roster-act')).toHaveText('Your choice');

    // …and Skip puts it back to writing nothing, so a mis-tap is always recoverable.
    await flagged.last().locator('.roster-choice-btn[data-opt="skip"]').click();
    await expect(saveBtn).toHaveText(/Save 3 changes/);
    await expect(flagged.last().locator('.roster-act')).toHaveClass(/act-read/);
    await expect(flagged.last().locator('.roster-act')).toHaveText("Couldn't read");

    // Then actually SAVE, and assert the picked value reaches the write. The counter above and the
    // save collector are two separate passes over the same state: asserting only the button text
    // left this with no teeth at all (breaking the collector kept every assertion green), and a
    // button promising N while N-1 are written is precisely the bug worth catching.
    await flagged.first().locator('.roster-choice-btn[data-opt="0"]').click();
    await expect(saveBtn).toHaveText(/Save 4 changes/);
    await saveBtn.click();
    await expect.poll(() => page.evaluate(() => (window.__E2E?.batchWrites || []).length)).toBe(4);
    const values = await page.evaluate(() => (window.__E2E?.batchWrites || []).map(w => w.value));
    // Thursday's first reading is RDW|14:30-22:00, which saves as the bare time with type 'rdw'.
    expect(values, 'the picked reading must be among the values written').toContain('14:30-22:00');
});

// "Skip all" must skip the row the admin was LEAST sure about (v21.94).
//
// `UNREADABLE` gained a writable `chosen` when the two-way pick shipped at v19.32; this handler
// predates it and branched only on DIFF/REMOVE_IMPORT/CONFLICT. So an admin who picked a reading and
// then pressed Skip all got a dimmed, `inert` section whose picked value was STILL WRITTEN by Save,
// with the chosen button keeping its highlight under the overlay.
//
// Driven through the real review table, because the bug was a missing branch in a delegated handler
// — there is no rule to unit-test, and the section state is inside a closure. The Save button's
// label is the observable consequence: with everything skipped it must offer nothing at all.
test('operations: Skip all also clears a resolved "couldn\'t read" pick', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await seedSession(page, 'G. Miller');
    await openRosterReview(page);

    const saveBtn = page.locator('#rosterApplyBtn');
    const flagged = page.locator('.roster-change-row').filter({ has: page.locator('.roster-choice-btn[data-opt="0"]') });
    await expect(saveBtn).toHaveText(/Save 3 changes/);

    // Resolve one flagged cell — now four things would be written.
    await flagged.first().locator('.roster-choice-btn[data-opt="0"]').click();
    await expect(saveBtn).toHaveText(/Save 4 changes/);

    // Skip all for that person. Every row in the section belongs to G. Miller, so nothing is left.
    await page.locator('.roster-skip-all-btn').first().click();
    await expect(saveBtn, 'the resolved flagged row was still going to be written').toHaveText(/Nothing to save/);
    await expect(saveBtn).toBeDisabled();

    // The row must SAY so too: back on Skip, back to "Couldn't read". A section that writes nothing
    // while a value still looks chosen is the same contradiction one layer down.
    await expect(flagged.first().locator('.roster-choice-btn--skip')).toHaveClass(/is-chosen/);
    await expect(flagged.first().locator('.roster-choice-btn[data-opt="0"]')).not.toHaveClass(/is-chosen/);

    // Restore brings the ticked rows back — and must NOT re-pick the flagged one. There is no safe
    // default for a cell nobody could read, which is why it starts on neither.
    await page.locator('.roster-skip-all-btn').first().click();
    await expect(saveBtn).toHaveText(/Save 3 changes/);
    await expect(flagged.first().locator('.roster-choice-btn[data-opt="0"]')).not.toHaveClass(/is-chosen/);
});

// The review's entry boxes share the week grid's typing rule (clock-input.js), and shared its defect
// (whole-app review, Oct 2026): "240" was reshaped to 02:40 as it was typed, so a midnight finish
// keyed as 2400 was entered as 02:40. Typed key by key it is now 24:00, which counts for nothing;
// three digits are a dropped zero only once the box is left.
test('operations: an entered finish typed as 2400 is refused, and 240 settles as 02:40 only when left', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await seedSession(page, 'G. Miller');
    await openRosterReview(page);
    const saveBtn = page.locator('#rosterApplyBtn');
    await expect(saveBtn).toHaveText(/Save 3 changes/);
    const garbled = page.locator('.roster-change-row', { hasText: 'XZ9 GARBLED' });
    await garbled.locator('.roster-choice-btn--enter').click();
    await garbled.locator('.roster-entry-pill', { hasText: 'Shift' }).click();
    const from = garbled.locator('.roster-entry-time[data-part="from"]');
    const to = garbled.locator('.roster-entry-time[data-part="to"]');
    await from.pressSequentially('1800');
    await to.pressSequentially('2400');
    await expect(to).toHaveValue('24:00');
    await expect(saveBtn, '24:00 is not a time, so nothing is entered').toHaveText(/Save 3 changes/);
    await to.fill('');
    await to.pressSequentially('240');
    await expect(to, 'still typing: it may yet be 2400').toHaveValue('24:0');
    await from.focus();
    await expect(to, 'left as three digits, it is a dropped zero').toHaveValue('02:40');
    await expect(saveBtn, 'and the settled time is what the entry now holds').toHaveText(/Save 4 changes/);
});

// The same hole on the OTHER unreadable row shape (v24.28 review): a row with no readings can hold
// an ENTERED value, and Skip all reset only rows that offered readings — so the entry was saved
// from under the overlay. And Restore re-ticked every row, including one the admin had unticked.
test('operations: Skip all clears an entered value, and Restore keeps each tick as it was', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await seedSession(page, 'G. Miller');
    await openRosterReview(page);
    const saveBtn = page.locator('#rosterApplyBtn');
    await expect(saveBtn).toHaveText(/Save 3 changes/);

    await page.locator('.roster-tick').first().click();                    // the admin unticks one
    await expect(saveBtn).toHaveText(/Save 2 changes/);
    const garbled = page.locator('.roster-change-row', { hasText: 'XZ9 GARBLED' });
    await garbled.locator('.roster-choice-btn--enter').click();
    await garbled.locator('.roster-entry-pill', { hasText: 'Shift' }).click();
    await garbled.locator('.roster-entry-time[data-part="from"]').fill('06:00');
    await garbled.locator('.roster-entry-time[data-part="to"]').fill('14:00');
    await expect(saveBtn).toHaveText(/Save 3 changes/);

    await page.locator('.roster-skip-all-btn').first().click();
    await expect(saveBtn, 'the entered value was still going to be written').toHaveText(/Nothing to save/);

    await page.locator('.roster-skip-all-btn').first().click();
    await expect(saveBtn, 'Restore re-ticked a row the admin had unticked').toHaveText(/Save 2 changes/);
    await expect(page.locator('.roster-tick').first()).toHaveAttribute('aria-pressed', 'false');
    await expect(garbled.locator('.roster-act')).toHaveText("Couldn't read");
});

// A row with no readings sitting over a MANUAL entry must show it too: entering a value replaces it
// (replaceId), and the table's guarantee is that a hand-recorded entry is never overwritten unseen.
test('operations: an unreadable row with no readings shows the saved entry it would replace', async ({ page }) => {
    await seedSession(page, 'G. Miller');
    const shifts = { ...ROSTER_REVIEW_PARSE.parsed[0].shifts, '2026-08-04': 'UNKNOWN|XZ9 GARBLED', '2026-08-05': 'RD' };
    await openRosterReview(page, { ...ROSTER_REVIEW_PARSE, parsed: [{ memberName: 'G. Miller', shifts }] });
    const row = page.locator('.roster-change-row', { hasText: 'XZ9 GARBLED' });
    await expect(row.locator('.roster-choice-btn--enter')).toHaveText('Enter the shift');
    await expect(row).toContainText('Saved');
    await expect(row.locator('.roster-cv-manual')).toContainText('23:00');
});

// The server's refusals are written FOR the admin ("check the roster type is correct"); a generic
// "Unexpected error" in their place hid the one instruction that would have fixed the upload.
test('operations: a refused roster read shows the server\'s own reason', async ({ page }) => {
    await seedSession(page, 'G. Miller');
    await page.route('**/parseRosterPDF*', route => route.fulfill({ status: 502, contentType: 'application/json',
        body: JSON.stringify({ error: 'The AI found no recognisable staff members — check the roster type is correct and try again' }) }));
    await page.goto('/operations.html');
    await page.evaluate(() => {
        const b = document.getElementById('rosterUploadBody');
        if (b && !b.classList.contains('open')) document.getElementById('rosterUploadToggleHeader')?.click();
    });
    await page.setInputFiles('#rosterFileInput',
        { name: 'roster.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 fixture') });
    await page.locator('#rosterParseBtn').click();
    await expect(page.locator('#rosterParseFeedback')).toContainText('check the roster type is correct');
});

// When nothing changed, the notes about the read still apply — the empty state used to ASSIGN the
// list's HTML and wipe them, including the name of a member the read never found.
test('operations: "no changes needed" keeps the notes about the read', async ({ page }) => {
    await seedSession(page, 'G. Miller');
    const { teamMembers, getBaseShift } = await import('../roster-data.js');
    const gm = teamMembers.find(m => m.name === 'G. Miller');
    const shifts = Object.fromEntries(ROSTER_REVIEW_DATES.map(d => {
        const [y, mo, da] = d.split('-').map(Number);
        return [d, getBaseShift(gm, new Date(y, mo - 1, da))];
    }));
    await openRosterReview(page, { ...ROSTER_REVIEW_PARSE, choices: {}, crossCheck: 'complete',
        missingMembers: ['S. Silva'], parsed: [{ memberName: 'G. Miller', shifts }] }, { noSavedEntries: true });
    await expect(page.locator('.roster-no-changes')).toBeVisible();
    await expect(page.locator('#rosterChangeList')).toContainText('Not found in this read');
    await expect(page.locator('.roster-download-pdf')).toBeVisible();
});

// Skip means "write nothing", so it must never wear the colour that means "this will be saved".
// Asserted on computed style rather than by screenshot: --text-mid (L45%) and --success-green
// (L48.5%) differ in HUE at near-equal luminance, and pixelmatch's delta is luminance-dominated, so
// the visual baseline provably cannot see this swap (verified in v19.34).
test('operations: the review table Skip button is not the success colour', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await seedSession(page, 'G. Miller');
    await openRosterReview(page);

    const flagged = page.locator('.roster-change-row').filter({ has: page.locator('.roster-choice-btn[data-opt="0"]') });
    await flagged.first().locator('.roster-choice-btn[data-opt="0"]').click();
    // The background transitions must FINISH, or both read as interpolated oklab() and a string
    // compare is meaningless — so wait for them to finish (the Web Animations API lists a CSS
    // transition), where this was a 300ms sleep guessing their length (test audit, 7 Nov 2026).
    await page.evaluate(() => Promise.all([...document.querySelectorAll('.roster-choice-btn')]
        .flatMap(el => el.getAnimations()).map(a => a.finished)));
    const [skipBg, valueBg] = await page.evaluate(() => [
        getComputedStyle(/** @type {Element} */ (document.querySelector('.roster-choice-btn--skip.is-chosen'))).backgroundColor,
        getComputedStyle(/** @type {Element} */ (document.querySelector('.roster-choice-btn[data-opt="0"].is-chosen'))).backgroundColor,
    ]);
    expect(skipBg, 'Skip must not wear the colour that means "this will be saved"').not.toBe(valueBg);
});

// ── Needs attention strip (v22.03) ───────────────────────────────────────────────────────────
// The unit suite owns the arithmetic; these cover what only a browser can — that the REAL card
// loads feed the strip (a severed report call leaves every unit test green), that clean means
// ABSENT, and that an item genuinely opens the card it names.
//
// The reset rows ride the fixtures' per-path seam (getResetRequests is a plain collection read);
// the client errors ride the shared e2e.docs (getClientErrors is query-wrapped, and the stub
// serves queries from the shared array — both of its queries see the same rows, so an exact
// on-screen error count is the stub's artefact, not the app's: assert presence, not arithmetic).

test('operations: a clean page has NO attention strip — absence is the all-clear', async ({ page }) => {
    // EVERY CARD THAT FEEDS THE STRIP HAS ANSWERED BEFORE ITS ABSENCE IS READ (test audit, 7 Nov
    // 2026). This asserted "hidden" as soon as the Account status card was on screen — which is
    // before any of the strip's three sources has loaded, so it passed against a page whose cards
    // had reported nothing yet, and would have passed against a strip that never rendered at all.
    // So all three are made to answer, and answer CLEAN: the reset requests, the error log, and the
    // account audit (whose endpoint is unreachable in this harness unless routed — the audit then
    // reports nothing, by design, which is not the all-clear this test is about).
    await seedSession(page);
    await page.addInitScript(() => { window.__E2E = { ...(window.__E2E || {}), authUser: true }; });
    await page.route('https://europe-west2-myb-roster.cloudfunctions.net/getAccountSetupGaps', route => route.fulfill({
        status: 200, contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({ setUp: [], leavers: [] }),
    }));
    await page.goto('/operations.html');
    await expect(page.locator('#accountStatusCard')).toBeVisible();
    await expect(page.locator('#resetRequestsContent'), 'the reset requests answered').toContainText('No outstanding requests');
    await expect(page.locator('#errorLogContent'), 'the error log answered').toContainText('No errors recorded');
    await expect(page.locator('#authSetupGaps'), 'the account audit answered').toContainText('Everyone on the roster has a login');
    await expect(page.locator('#attentionStrip')).toBeHidden();
});

test('operations: outstanding resets and errors surface in the strip, and an item opens its card', async ({ page }) => {
    await seedSession(page);
    await page.addInitScript(() => {
        window.__E2E = Object.assign(window.__E2E || {}, {
            docsByPath: { resetRequests: [
                { id: 'S. Silva', memberName: 'S. Silva', requestedAt: Date.now() - 3600e3, count: 2, provisioned: true },
                { id: 'M. Robson', memberName: 'M. Robson', requestedAt: Date.now() - 60e3, count: 1, provisioned: true },
            ] },
            docs: [
                { id: 'err1', memberName: 'G. Miller', page: 'admin.html', message: 'boom', stack: '', appVersion: 'x', userAgent: 'ua', timestamp: Date.now(), resolved: false },
            ],
        });
    });
    await page.goto('/operations.html');
    const strip = page.locator('#attentionStrip');
    await expect(strip).toBeVisible();
    await expect(strip).toContainText('Needs attention');
    // The full sentence is the ACCESSIBLE NAME; the visible pill is the card-header echo.
    await expect(strip.getByRole('link', { name: 'Password resets: 2 waiting' })).toBeVisible();
    await expect(strip.locator('a[href="#reset-requests"] .attn-count')).toHaveText('2');
    await expect(strip.getByRole('link', { name: /^Unresolved errors: / })).toBeVisible();

    // The jump: the error-log card is collapsed by default; the strip item must open it.
    await expect(page.locator('#errorLogBody')).not.toHaveClass(/open/);
    await page.locator('#attentionStrip a[href="#error-log"]').click();
    await expect(page.locator('#errorLogBody')).toHaveClass(/open/);
    // …and a REPEAT tap after the admin closes the card still works (same hash, no hashchange).
    await page.locator('#errorLogToggleHeader').click();
    await expect(page.locator('#errorLogBody')).not.toHaveClass(/open/);
    await page.locator('#attentionStrip a[href="#error-log"]').click();
    await expect(page.locator('#errorLogBody')).toHaveClass(/open/);
});

test('operations: resets alone show one item, and the strip never renders a zero', async ({ page }) => {
    await seedSession(page);
    await page.addInitScript(() => {
        window.__E2E = Object.assign(window.__E2E || {}, {
            docsByPath: { resetRequests: [
                { id: 'S. Silva', memberName: 'S. Silva', requestedAt: Date.now(), count: 1, provisioned: true },
            ] },
        });
    });
    await page.goto('/operations.html');
    const strip = page.locator('#attentionStrip');
    await expect(strip).toBeVisible();
    await expect(strip.getByRole('link', { name: 'Password resets: 1 waiting' })).toBeVisible();
    await expect(strip.locator('a[href="#error-log"]')).toHaveCount(0);
});

test('operations: no account-status name is truncated at phone width', async ({ page }) => {
    /*
     * The NAME is what identifies a row on a 51-row list, and at 375px it was the element being
     * cut — "C. Francisco-C…", "R. Forrester-Bla…", "L. Atrakimavici…" — while a chip reading the
     * same fifteen characters ("Surname default") on every unmigrated row kept its full width
     * (v21.72). Truncating the one unique thing to make room for the one identical thing is
     * exactly backwards, and no behavioural test could see it: every assertion about this card
     * passed throughout, because the DOM text was always complete. Only the pixels were wrong.
     *
     * `scrollWidth > clientWidth` is the ellipsis itself, asked of the real rendered row.
     */
    await page.setViewportSize({ width: 375, height: 2000 });
    await seedSession(page);
    await seedMember(page);
    await page.goto('/operations.html');
    await expect(page.locator('#accountStatusCard')).toBeVisible({ timeout: 10000 });
    await page.evaluate(() => /** @type {HTMLElement|null} */ (
        document.querySelector('#accountStatusCard .card-header-toggle'))?.click());
    await expect(page.locator('.acct-name').first()).toBeVisible();
    const clipped = await page.evaluate(() => [...document.querySelectorAll('.acct-name')]
        .filter(el => el.scrollWidth > el.clientWidth + 1)
        .map(el => el.textContent));
    expect(clipped, 'account names clipped at 375px — the row cannot be identified').toEqual([]);
});

/**
 * THE PAGE BADGE SHORTENS ON A PHONE, AND THE POINT IS PROPORTION, NOT OVERFLOW.
 *
 * v22.23 spelled this badge "Operations" in full on every width. Nothing overflowed, nothing
 * collided, and no test failed — which is precisely why it shipped: the check that was run asked
 * whether it FITS. It does. Measured on a phone it rendered 104px against a 126px "Marylebone
 * Roster", so the section label was 83% the width of the app's own name and read as loud as it,
 * which is what the owner reported from a real handset.
 *
 * So this asserts the CONTRACT (which form renders on which side of the 768px desktop-header line)
 * rather than a ratio threshold, because a threshold is a number nobody can defend. The ratio is
 * recorded in the failure message instead, so a regression says how bad it got.
 */
test('operations: the page badge is short on a phone and full on desktop, and never crowds the title', async ({ page }) => {
    const read = async (w) => {
        await page.setViewportSize({ width: w, height: 800 });
        await seedSession(page, 'G. Miller');
        await page.goto('/operations.html');
        await page.locator('#opsBadge').waitFor({ state: 'visible' });
        return page.evaluate(() => {
            const badge = document.getElementById('opsBadge');
            const h1 = document.querySelector('.app-header-brand h1');
            const hdr = document.querySelector('.app-header');
            const bb = badge.getBoundingClientRect(), tb = h1.getBoundingClientRect(), hb = hdr.getBoundingClientRect();
            return {
                text: badge.innerText.replace(/\s+/g, ' ').trim(),
                bw: Math.round(bb.width), tw: Math.round(tb.width),
                over: Math.round(bb.right) > Math.round(hb.right) + 1,
                coll: Math.round(tb.right) > Math.round(bb.left),
                doc: document.documentElement.scrollWidth > document.documentElement.clientWidth,
            };
        });
    };

    // Below the 768px desktop-header line: the short form, and it must stay a modest fraction of
    // the title. 0.42 measured; 0.6 is the line at which it starts reading as a competing heading.
    for (const w of [320, 360, 390, 412, 767]) {
        const r = await read(w);
        expect(r.text, `@${w}px the badge should read "Ops", not the full word`).toMatch(/^🔧\s*OPS$/i);
        expect(r.over || r.coll || r.doc, `@${w}px the header overflowed or collided`).toBe(false);
        expect(r.bw / r.tw, `@${w}px badge ${r.bw}px vs title ${r.tw}px — it is crowding the app name`).toBeLessThan(0.6);
    }

    // At and above it there is room to spare, and the full word is clearer.
    for (const w of [768, 1280]) {
        const r = await read(w);
        expect(r.text, `@${w}px the badge should read "Operations" in full`).toMatch(/^🔧\s*OPERATIONS$/i);
        expect(r.over || r.coll || r.doc, `@${w}px the header overflowed or collided`).toBe(false);
    }
});

test('operations: no App Speed row label is truncated at phone width', async ({ page }) => {
    /*
     * The same fault as the account-status one above, on the card that had just gained a block.
     * Found by SCREENSHOTTING it (v22.00) rather than by any assertion: two rows read "From the
     * save…" and "Pay calcul…" at 390px, and one of them was the label naming the whole distinction
     * the new block exists to draw. Every behavioural test passed throughout, because the DOM text
     * was complete and only the pixels were wrong — which is exactly what the account-status guard
     * says about its own defect, so the card that learned the lesson was not the card that needed it.
     *
     * Both label kinds are checked. Since the App Speed review (Oct 2026) a name WRAPS rather than
     * ellipsising — "Shifts s…" at 375px was a label that could not be read — so this now guards the
     * wrap: a name that cannot wrap and overflows its box is still caught.
     */
    // SEEDED, because an empty card is not a passing truncation test — it is no test. The fixture is
    // the visual baseline's own, shared through helpers.js so the guard and the picture cannot end
    // up describing two different cards.
    await stubPerfReads(page);
    await page.setViewportSize({ width: 390, height: 2400 });
    await seedSession(page);
    await seedMember(page);
    await page.goto('/operations.html');
    await expect(page.locator('#pageSpeedCard')).toBeVisible({ timeout: 10000 });
    await page.evaluate(() => {
        const b = document.getElementById('pageSpeedBody');
        if (b && !b.classList.contains('open')) document.getElementById('pageSpeedToggleHeader')?.click();
    });
    await expect(page.locator('#pageSpeedCard')).toContainText('Before the sign-in check');
    // The ROW, not the words: a text match passed with the block deleted once (v24.85, found by mutation).
    await expect(page.locator('#pageSpeedCard .speed-row-name', { hasText: /^Own roster$/ })).toHaveCount(1);
    const names = page.locator('#pageSpeedCard .speed-row-name');
    expect(await names.count(), 'the fixture did not reach the card — nothing is being measured')
        .toBeGreaterThan(8);
    const clipped = await page.evaluate(() => [...document.querySelectorAll('#pageSpeedCard .speed-row-name')]
        .filter(el => el.scrollWidth > el.clientWidth + 1)
        .map(el => el.textContent));
    expect(clipped, 'App Speed labels clipped at 390px — the row cannot be read').toEqual([]);
});


// ── A SHIFTED READ IS REFUSED, IN A REAL BROWSER (v22.16, external review) ─────────────────────
//
// The rules are unit-tested in admin-roster-upload.test.mjs. What only a browser can answer is
// whether the WIRING holds: that the refusal reaches the screen, that the Save button stops
// offering to save, and — the one that matters — that pressing it writes NOTHING. The batch mock
// records every `set()` payload (`window.__E2E.batchWrites`), so this asserts on what was actually
// written rather than on a summary line claiming a count. Those are two separate passes over the
// same state, and asserting the counter alone has no teeth: that lesson is already recorded in
// this file for the roster review picker.
test('operations: a roster read that looks a day out is refused, and writes nothing', async ({ page }) => {
    // The fixture is built from the REAL detector against the REAL roster, not hard-coded names
    // that go stale the next time somebody joins. That is possible because the alignment rules left
    // the coordinator at v22.16 — `roster-alignment.js` imports no Firebase, so it loads in Node,
    // where `admin-roster-upload.js` cannot (it reaches the gstatic SDK).
    const { teamMembers, getBaseShift } = await import('../roster-data.js');
    const { detectShiftedRow } = await import('../roster-alignment.js');
    const DATES = ['2026-08-02', '2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07', '2026-08-08'];
    const rowFor = (/** @type {any} */ m, /** @type {number} */ off) => Object.fromEntries(DATES.map(d => {
        const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + off);
        return [d, getBaseShift(m, x)];
    }));
    // Members the detector can actually SEE drifting — it is deliberately conservative, and a
    // member whose pattern looks the same on adjacent days stays silent by design.
    const drifted = teamMembers
        .filter(/** @param {any} m */ m => !m.hidden && !m.managerOnly && m.rosterType === 'main'
            && detectShiftedRow(m, rowFor(m, 1), DATES) === 'left')
        .slice(0, 3)
        .map(/** @param {any} m */ m => ({ memberName: m.name, shifts: rowFor(m, 1) }));
    expect(drifted.length, 'fixture needs three detectably-drifted members').toBe(3);

    await seedSession(page, 'G. Miller');

    await openRosterReview(page, {
        weekEnding: '2026-08-08', rosterType: 'cea', dates: DATES,
        crossCheck: 'complete', missingMembers: [], choices: {},
        parsed: drifted,
    });

    // The refusal is stated, and names who.
    const stop = page.locator('.roster-alignment-stop');
    await expect(stop).toBeVisible();
    await expect(stop).toContainText('has not been saved');
    await expect(stop).toContainText(drifted[0].memberName);

    // Nothing is ticked, and the Save button is GONE rather than relabelled — a disabled control
    // reading "Read the roster again" put the instruction on the one thing that could not carry it
    // out, while the button that can sat underneath as the quiet secondary.
    await expect(page.locator('.roster-tick:not(.off)')).toHaveCount(0);
    await expect(page.locator('#rosterApplyBtn')).toBeHidden();
    const remedy = page.locator('#rosterCancelBtn');
    await expect(remedy).toBeVisible();
    await expect(remedy).toHaveText('Read the roster again');
    await expect(remedy).toHaveClass(/roster-cancel-btn--primary/);

    // No per-row escape hatch: a tick on a refused read does nothing at all — and SAYS so, disabled
    // and off the Tab order like every control of a refused read (whole-app fix, Nov 2026).
    const firstTick = page.locator('.roster-tick').first();
    await expect(firstTick).toBeDisabled();
    await expect(page.locator('.roster-person-section button:not([disabled])')).toHaveCount(0);
    await firstTick.click({ force: true });
    await expect(page.locator('.roster-tick:not(.off)')).toHaveCount(0);

    // THE HARD GATE, ISOLATED. Everything above is satisfied by `chosen: false` alone — deleting
    // the `rosterBlocked` guard in the save loop left this test green, which is how it was found.
    // So this case forces the state a future renderer (or a stray handler) could produce: every
    // row ticked, the button enabled, the click pressed. The write is what is asserted, not the
    // label, because the batch mock records payloads and a summary count is a separate pass.
    await page.evaluate(() => {
        document.querySelectorAll('.roster-tick').forEach(t => /** @type {HTMLElement} */ (t).click());
        const b = /** @type {HTMLButtonElement} */ (document.getElementById('rosterApplyBtn'));
        if (b) { b.disabled = false; b.click(); }
    });
    // THE SAVE HAS ANSWERED before its writes are counted (test audit, 7 Nov 2026 — this was a
    // 500ms sleep before a count of zero, which also holds for a save that had not run yet). Either
    // way it ends with a line in the feedback: "Nothing to save" when the gate held, "Done — N
    // changes applied" once a batch has been written. So the count below is read after the
    // decision, and a gate that failed shows as writes rather than as a timeout.
    await expect(page.locator('#rosterApplyFeedback')).toHaveText(/Nothing to save|Done —/);
    const writes = await page.evaluate(() => (/** @type {any} */ (window).__E2E?.batchWrites || []).length);
    expect(writes, 'a refused read must write nothing even if every row is forced on').toBe(0);
});

// The PDF's OWN GRID as a witness (v22.31, ROADMAP "Roster import" phase 1). The server refuses a row
// whose AI-read day lands in a physically empty cell and names it in `geometryRefused`; the client
// must treat that row exactly like a base-roster drift — unticked, explained — through the same
// wiring, and its words must not borrow a direction geometry does not have. The unit tests own the
// verdict; this owns that the verdict reaches the screen with the right sentence on it.
test('operations: a row the PDF\'s own grid refused starts unticked, and says so in its own words', async ({ page }) => {
    const { teamMembers, getBaseShift } = await import('../roster-data.js');
    const { detectShiftedRow } = await import('../roster-alignment.js');
    const DATES = ['2026-08-02', '2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07', '2026-08-08'];
    const honest = (/** @type {any} */ m) => Object.fromEntries(DATES.map(d => [d, getBaseShift(m, new Date(d + 'T12:00:00'))]));
    // An HONEST week with one changed day, so the base-roster detector is silent and the only
    // reason the row is held back is the server's refusal.
    const m = teamMembers.find(/** @param {any} x */ x => x.name === 'G. Miller');
    const shifts = { ...honest(m), [DATES[1]]: '22:00-06:00' };
    expect(detectShiftedRow(m, shifts, DATES), 'fixture: the detector must be silent').toBeNull();

    await seedSession(page, 'G. Miller');
    await openRosterReview(page, {
        weekEnding: '2026-08-08', rosterType: 'cea', dates: DATES,
        crossCheck: 'complete', missingMembers: [], choices: {},
        geometry: { status: 'complete', checked: 1, total: 1, pagesRead: 1, pagesRejected: 0 },
        geometryRefused: ['G. Miller'],
        parsed: [{ memberName: 'G. Miller', shifts }],
    });

    const warn = page.locator('.roster-shift-warning');
    await expect(warn).toBeVisible();
    await expect(warn).toContainText("PDF's own table has an empty cell");
    await expect(warn).not.toContainText('shifted a day');
    await expect(page.locator('.roster-person-suspect')).toHaveCount(1);
    await expect(page.locator('.roster-tick:not(.off)')).toHaveCount(0);
    // The withheld count names the outcome, as it does for a base-roster drift.
    await expect(page.locator('#rosterOutcome')).toContainText('held back');
    // …and only while the row IS held back (whole-app review, Oct 2026): ticked after checking the
    // PDF, it is counted as saving, and the same day must not also read as withheld.
    await page.locator('.roster-tick').first().click();
    await expect(page.locator('#rosterOutcome')).toContainText('will be updated');
    await expect(page.locator('#rosterOutcome')).not.toContainText('held back');
});

test('operations: three rows the PDF\'s own grid refused REFUSE the read, without claiming a direction', async ({ page }) => {
    const { teamMembers, getBaseShift } = await import('../roster-data.js');
    const DATES = ['2026-08-02', '2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07', '2026-08-08'];
    const honest = (/** @type {any} */ m) => Object.fromEntries(DATES.map(d => [d, getBaseShift(m, new Date(d + 'T12:00:00'))]));
    const three = teamMembers.filter(/** @param {any} m */ m => !m.hidden && !m.managerOnly && m.rosterType === 'main').slice(0, 3);
    await seedSession(page, 'G. Miller');
    await openRosterReview(page, {
        weekEnding: '2026-08-08', rosterType: 'cea', dates: DATES,
        crossCheck: 'complete', missingMembers: [], choices: {},
        geometryRefused: three.map(m => m.name),
        parsed: three.map(m => ({ memberName: m.name, shifts: { ...honest(m), [DATES[1]]: '22:00-06:00' } })),
    });
    const stop = page.locator('.roster-alignment-stop');
    await expect(stop).toBeVisible();
    await expect(stop).toContainText('has not been saved');
    await expect(stop).toContainText("PDF's own table has an empty cell");
    await expect(stop).not.toContainText('shifted a day');
    await expect(page.locator('.roster-tick:not(.off)')).toHaveCount(0);
    await expect(page.locator('#rosterApplyBtn')).toBeHidden();
});

// Whole-app fix, Nov 2026 (import-client-13): on a refused read the primary button says "Read the
// roster again" — and it only cleared the form, the chosen PDF with it, so nothing was read until the
// admin found the same file again. It now reads it again.
test('operations: "Read the roster again" on a refused read reads the same PDF again', async ({ page }) => {
    const DATES = ['2026-08-02', '2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07', '2026-08-08'];
    const honest = (/** @type {any} */ m) => Object.fromEntries(DATES.map(d => [d, getBaseShift(m, new Date(d + 'T12:00:00'))]));
    const three = teamMembers.filter(m => !m.hidden && !m.managerOnly && m.rosterType === 'main').slice(0, 3);
    await seedSession(page, 'G. Miller');
    await openRosterReview(page, {
        weekEnding: '2026-08-08', rosterType: 'cea', dates: DATES, crossCheck: 'complete', missingMembers: [], choices: {},
        geometryRefused: three.map(m => m.name),
        parsed: three.map(m => ({ memberName: m.name, shifts: { ...honest(m), [DATES[1]]: '22:00-06:00' } })),
    });
    await expect(page.locator('.roster-alignment-stop')).toBeVisible();
    // The second read is a good one — the route registered last answers first.
    let reads = 0;
    await page.route('**/parseRosterPDF*', route => { reads++; return route.fulfill({ status: 200,
        contentType: 'application/json', body: JSON.stringify(ROSTER_REVIEW_PARSE) }); });
    await page.locator('#rosterCancelBtn').click();
    await expect(page.locator('#rosterApplyBtn')).toHaveText(/Save 3 changes/);
    await expect(page.locator('.roster-alignment-stop')).toHaveCount(0);
    expect(reads, 'the PDF was read again').toBe(1);
    await expect(page.locator('#rosterFileName')).toHaveText('roster.pdf');
    // …and the ordinary button is still "Upload a different file", which clears the form as before.
    await expect(page.locator('#rosterCancelBtn')).toHaveText('Upload a different file');
    await page.locator('#rosterCancelBtn').click();
    await expect(page.locator('#rosterReviewSection')).not.toHaveClass(/visible/);
    await expect(page.locator('#rosterParseBtn')).toBeDisabled();
    expect(reads).toBe(1);
});

test('operations: the review says when the PDF layout check did not run', async ({ page }) => {
    // THE WIRING, which is what escaped: `geometry.status` had been in the response for nine
    // versions and no client code read it, so a fail-open witness produced a review that looked
    // exactly like one where the grid agreed with every cell (v22.39 external review). The words
    // are unit-tested in admin-roster-upload.test.mjs; only a rendered page proves they arrive.
    await seedSession(page, 'G. Miller');
    await openRosterReview(page, {
        ...ROSTER_REVIEW_PARSE,
        geometry: { status: 'unavailable', checked: 0, total: 1, pagesRead: 0, pagesRejected: 1 },
    });
    await expect(page.locator('.roster-crosscheck-note', { hasText: 'PDF layout check' }))
        .toContainText('one method only');
});

test('operations: a complete PDF layout check adds no banner at all', async ({ page }) => {
    // The other direction. On this surface an absence of warnings IS the good state, so a green
    // "✓ layout checked" would be one more thing to read past on every single import.
    await seedSession(page, 'G. Miller');
    await openRosterReview(page, {
        ...ROSTER_REVIEW_PARSE,
        geometry: { status: 'complete', checked: 1, total: 1, pagesRead: 1, pagesRejected: 0 },
    });
    await expect(page.locator('.roster-change-row').first()).toBeVisible();   // the review really rendered
    await expect(page.locator('.roster-crosscheck-note', { hasText: 'PDF layout check' })).toHaveCount(0);
});

test('operations: the review HANDS OVER the original PDF to check against', async ({ page }) => {
    // Every message this release adds ends in "check it against the PDF". Until v22.16 the file had
    // effectively left the workflow once the parse returned, so failing closed asked the admin to
    // consult something they could no longer reach.
    //
    // THIS TEST USED TO ASSERT THE BUTTON WAS VISIBLE, and it was — for six releases, over a
    // `window.open` of a blob: URL that painted a blank tab, because a blob document inherits this
    // page's `object-src 'none'` and Chrome's PDF viewer is a plugin embed. Visible is not working.
    // The only assertion that could have caught it is the one that takes delivery of the file.
    await seedSession(page, 'G. Miller');
    await openRosterReview(page);
    const view = page.locator('.roster-download-pdf');
    await expect(view).toBeVisible();
    await expect(view).toContainText('roster.pdf');
    const [download] = await Promise.all([page.waitForEvent('download'), view.click()]);
    expect(download.suggestedFilename()).toBe('roster.pdf');
    expect(await download.path()).toBeTruthy();          // it really arrived, with bytes behind it

    // It hands over the file the review was READ from — not whatever the picker holds now. It read
    // the picker at click time, so choosing the next week's PDF turned this into a download of that.
    await page.setInputFiles('#rosterFileInput',
        { name: 'next-week.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 other') });
    const [again] = await Promise.all([page.waitForEvent('download'), view.click()]);
    expect(again.suggestedFilename()).toBe('roster.pdf');
});


// ── CHRISTMAS DAY AND BOXING DAY ARE THE APP'S CHRISTMAS LEAVE'S TO DECIDE (owner, 10 Nov 2026) ──
// The rules are unit-tested (admin-roster-upload.test.mjs → "a Christmas-week import"). What only the
// page shows is the row: unticked, saying why, asking no swap question — and a tick there written.
test('operations: a Christmas-week roster leaves 25 and 26 December unticked, and a tick there is written', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await seedSession(page, 'G. Miller');
    const me = teamMembers.find(m => m.name === 'G. Miller');
    const dates = ['2026-12-20', '2026-12-21', '2026-12-22', '2026-12-23', '2026-12-24', '2026-12-25', '2026-12-26'];
    const shifts = Object.fromEntries(dates.map(d => [d, getBaseShift(me, new Date(d + 'T12:00:00'))]));
    shifts['2026-12-22'] = shifts['2026-12-22'] === '10:00-18:00' ? '11:00-19:00' : '10:00-18:00';
    shifts['2026-12-25'] = 'AL';
    shifts['2026-12-26'] = '13:30-21:00';
    await openRosterReview(page, { weekEnding: '2026-12-26', rosterType: 'cea', dates, crossCheck: 'complete',
        missingMembers: [], choices: {}, geometry: { status: 'complete' }, parsed: [{ memberName: 'G. Miller', shifts }] },
        { noSavedEntries: true });
    const row = (/** @type {string} */ d) => page.locator(`.roster-change-row[data-key="G. Miller|${d}"]`);
    const save = page.locator('#rosterApplyBtn');

    await expect(row('2026-12-22').locator('.roster-tick')).toHaveAttribute('aria-pressed', 'true');
    await expect(row('2026-12-26').locator('.roster-tick')).toHaveAttribute('aria-pressed', 'false');
    await expect(row('2026-12-26')).toContainText('Not selected — the app’s Christmas leave decides 25 and 26 December.');
    await expect(row('2026-12-25')).toContainText('The app’s Christmas leave decides 25 and 26 December, so nothing is recorded.');
    await expect(row('2026-12-25').locator('[data-swap]'), 'no swapped-day question on Christmas Day').toHaveCount(0);
    await expect(save).toHaveText(/Save 1 change$/);
    await expect(page.locator('#rosterOutcome')).toContainText('1 day not selected — the app’s Christmas leave decides 25 and 26 December');

    await row('2026-12-26').locator('.roster-tick').click();   // a Boxing Day really worked, ticked on purpose
    await expect(save).toHaveText(/Save 2 changes/);
    await save.click();
    await expect(page.locator('#rosterApplyFeedback')).toContainText('Done — 2 changes applied');
    const written = await page.evaluate(() => (/** @type {any} */ (window).__E2E.batchWrites || [])
        .map((/** @type {any} */ w) => [w.date, w.value]).sort());
    expect(written).toEqual([['2026-12-22', shifts['2026-12-22']], ['2026-12-26', '13:30-21:00']]);
});

// ── A DAY THE IMPORT DECLINED TO RECORD MUST STILL APPEAR (v23.97) ────────────────────────────
//
// `computeCellStates` normalises leave or an absence on a base rest day to RD before it picks a
// state, so the comparison saw `RD === RD` and returned MATCH — and MATCH rows are not rendered.
// The PDF said annual leave; the admin was shown nothing at all for that day.
//
// The unit tests pin the state. Only a browser can answer the half that made it invisible: whether
// a row is actually DRAWN, since the defect was never in the classification's value — it was in a
// rendering predicate two hundred lines away that listed four states and not this one.
test('operations: a rest day the roster marked as leave is shown, and writes nothing', async ({ page }) => {
    await seedSession(page, 'G. Miller');
    // 2026-08-05 is a base REST day for this member and carries no saved override (2026-08-04 is
    // also a rest day, but the fixture seeds a manual entry there, so it is a CONFLICT and takes a
    // different branch entirely). The PDF marking a rest day AL is the real case: a blanket block
    // written across a week, which the app must not charge to anybody's entitlement.
    await openRosterReview(page, {
        ...ROSTER_REVIEW_PARSE,
        choices: {},
        parsed: [{
            memberName: 'G. Miller',
            shifts: { ...ROSTER_REVIEW_PARSE.parsed[0].shifts, '2026-08-05': 'AL' },
        }],
    });

    const row = page.locator('.roster-change-row.roster-change-guarded');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('A rest day on the base roster');
    await expect(row, 'asked in place, not sent to another page (v24.42)').not.toContainText('Change a Shift');
    await expect(row, 'said once, by the tag — not again in the reason (v24.41)').not.toContainText(/not recorded.*not recorded/is);
    await expect(row).toContainText('Not recorded');
    await expect(row).toContainText('5 Aug');

    // It is a notice, not a change: no tick to approve, and nothing pending on it.
    await expect(row.locator('.roster-tick')).toHaveCount(0);

    // And it must not inflate the person's pending count — an admin who sees "3" goes looking for
    // a third thing to approve and finds two.
    const badge = await page.locator('.roster-change-badge').first().innerText();
    const pending = await page.locator('.roster-change-row').count()
                  - await page.locator('.roster-change-row.roster-change-guarded').count();
    expect(Number(badge)).toBe(pending);
});

// ── …AND THE ADMIN CAN SAY IT WAS A SWAPPED WORKING DAY, IN PLACE (v24.42, owner) ─────────────
//
// "Why can't I enter the correct shift there?" v24.41 sent the admin to Change a Shift, where a bare
// absence on a base rest day is hidden. The row now asks. Driven to the WRITE, because the counter
// and the collector are separate passes and a Save label promising a change that is not written is
// the bug worth catching — and the write must carry `replacedType`, or the Calendar hides it.
test('operations: a rest-day absence answered "swapped" is written as a swapped-in day', async ({ page }) => {
    await seedSession(page, 'G. Miller');
    await openRosterReview(page, {
        ...ROSTER_REVIEW_PARSE,
        choices: {},
        parsed: [{ memberName: 'G. Miller', shifts: { ...ROSTER_REVIEW_PARSE.parsed[0].shifts, '2026-08-05': 'SICK' } }],
    });
    const saveBtn = page.locator('#rosterApplyBtn');
    const row = page.locator('.roster-change-row.roster-change-guarded');
    await expect(row).toContainText('Was it a swapped working day?');
    const before = Number((await saveBtn.innerText()).match(/\d+/)?.[0]);

    await row.locator('[data-swap="yes"]').click();
    await expect(row.locator('.roster-act')).toHaveText('Will record');
    await expect(row.locator('[data-swap="yes"]'), 'focus stays on the answer after the redraw').toBeFocused();
    await expect(saveBtn).toHaveText(new RegExp(`Save ${before + 1} changes`));

    // A mis-tap is recoverable: "rest day" takes it back out.
    await row.locator('[data-swap="no"]').click();
    await expect(row.locator('.roster-act')).toHaveText('Not recorded');
    await expect(saveBtn).toHaveText(new RegExp(`Save ${before} change`));

    await row.locator('[data-swap="yes"]').click();
    await saveBtn.click();
    await expect.poll(() => page.evaluate(() => (window.__E2E?.batchWrites || []).length)).toBe(before + 1);
    const writes = await page.evaluate(() => (window.__E2E?.batchWrites || []).filter(w => w.date === '2026-08-05'));
    expect(writes.map(w => [w.type, w.value, w.replacedType])).toEqual([['sick', 'SICK', 'shift']]);
});

// ── RE-UPLOADING THE SAME ROSTER MUST NOT DELETE AN ANSWERED SWAP (Oct 2026 production review) ──
// An answered "Swapped — record it" is written as a roster_import. The next upload of the SAME PDF
// classified that import as stale (REMOVE_IMPORT, pre-ticked), and Save deleted the confirmed
// absence. Driven to the write, because the defect was a delete nobody chose.
test('operations: re-uploading a roster leaves an already-recorded swapped absence alone', async ({ page }) => {
    await seedSession(page, 'G. Miller');
    await openRosterReview(page, {
        ...ROSTER_REVIEW_PARSE,
        choices: {},
        parsed: [{ memberName: 'G. Miller', shifts: { ...ROSTER_REVIEW_PARSE.parsed[0].shifts, '2026-08-05': 'SICK' } }],
    }, { extraDocs: [{ id: 'imp-swap', memberName: 'G. Miller', date: '2026-08-05', value: 'SICK', type: 'sick',
                       source: 'roster_import', replacedType: 'shift', note: '' }] });
    await expect(page.locator('.roster-change-row.roster-change-guarded'), 'the recorded answer is asked about again').toHaveCount(0);
    await expect(page.locator('.roster-change-row', { hasText: '5 Aug' }).filter({ hasText: /clear|remove/i })).toHaveCount(0);
    await page.locator('#rosterApplyBtn').click();
    await expect.poll(() => page.evaluate(() => (window.__E2E?.batchWrites || []).length)).toBeGreaterThan(0);
    const deleted = await page.evaluate(() => window.__E2E?.batchDeletes || []);
    expect(deleted.some(p => p.endsWith('/imp-swap')), 'the confirmed absence was deleted').toBe(false);
});

// ── THE REVIEW ON A PHONE (v24.90, owner's screenshot) ───────────────────────────────────────
//
// "This looks messy": on a phone set to large text a guarded row's ABSENT badge drew over its own
// "Not recorded" tag ("IOT RECORDED"), "New roster" wrapped onto two lines, and people with nothing
// to approve wore a "0" badge and a Skip all. Each was invisible at the size the tests ran at.

/** A second member for the review, taken from the roster rather than named: a CEA whose base week
 *  has a worked weekday and a Monday-to-Saturday rest day. `base` is that week, so a parse built
 *  from it matches everywhere except the days a test changes, and only those are drawn. */
function secondReviewMember() {
    const at = (/** @type {string} */ iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
    for (const m of teamMembers) {
        if (m.hidden || m.managerOnly || m.role !== 'CEA' || m.name === 'G. Miller') continue;
        const base = Object.fromEntries(ROSTER_REVIEW_DATES.map(iso => [iso, getBaseShift(m, at(iso))]));
        const rest = ROSTER_REVIEW_DATES.slice(1).find(iso => base[iso] === 'RD');
        const worked = ROSTER_REVIEW_DATES.slice(1).find(iso => /^\d\d:\d\d-\d\d:\d\d$/.test(base[iso]));
        if (rest && worked) return { name: m.name, base, rest, worked };
    }
    throw new Error('no CEA has a worked weekday and a weekday rest day in the fixture week');
}

test('operations: no review row draws one thing over another, or clips a label, at large text (v24.90) @layout', async ({ page }) => {
    await seedSession(page, 'G. Miller');
    await page.setViewportSize({ width: 390, height: 1600 });
    // Every row shape the owner's screenshot held: changed days, two conflicts, and a rest day that
    // asks the swap question — the row whose badge drew over its tag.
    await openRosterReview(page, { ...ROSTER_REVIEW_PARSE, choices: {}, parsed: [{ memberName: 'G. Miller',
        shifts: { ...ROSTER_REVIEW_PARSE.parsed[0].shifts, '2026-08-05': 'SICK',
                  '2026-08-06': '14:00-22:30', '2026-08-07': '08:00-16:30' } }] });
    await expect(page.locator('.roster-change-row.roster-change-guarded')).toHaveCount(1);
    await expect(page.locator('.roster-change-row.roster-change-conflict')).toHaveCount(2);
    // Android's Font size multiplies used font sizes and leaves the viewport alone, so this scales
    // every element from its ORIGINAL size — scaling in one pass would compound down nested text.
    await page.evaluate(() => {
        /** @type {any} */ (window).__sizes = [...document.querySelectorAll('*')].map(el => [el, parseFloat(getComputedStyle(el).fontSize)]);
    });
    for (const mult of [1, 1.3, 1.6]) {
        const faults = await page.evaluate((k) => {
            for (const [el, px] of /** @type {any} */ (window).__sizes) if (px) el.style.fontSize = (px * k) + 'px';
            const out = [];
            const LEAVES = '.shift-badge, .review-shift-time, .roster-act, .roster-day-abbr, .roster-day-date, .roster-guard-lab, '
                + '.roster-cb-lab, .roster-arrow, .roster-tick, .roster-choice-btn, .roster-remove-note, .roster-guard-note';
            for (const row of document.querySelectorAll('#rosterChangeList .roster-change-row')) {
                const leaves = [...row.querySelectorAll(LEAVES)].filter(el => el.getBoundingClientRect().width > 0);
                for (let i = 0; i < leaves.length; i++) for (let j = i + 1; j < leaves.length; j++) {
                    if (leaves[i].contains(leaves[j]) || leaves[j].contains(leaves[i])) continue;
                    const a = leaves[i].getBoundingClientRect(), b = leaves[j].getBoundingClientRect();
                    const x = Math.min(a.right, b.right) - Math.max(a.left, b.left), y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
                    if (x > 1 && y > 1) out.push(`overlap: "${leaves[i].textContent?.trim()}" × "${leaves[j].textContent?.trim()}"`);
                }
                for (const el of row.querySelectorAll('.roster-choice-btn, .roster-act, .roster-cb-lab, .roster-guard-lab')) {
                    if (el.scrollWidth > el.clientWidth + 1) out.push(`clipped: "${el.textContent?.trim()}"`);
                }
                for (const el of row.querySelectorAll('.roster-cb-lab, .roster-guard-lab')) {
                    if (el.getBoundingClientRect().height > parseFloat(getComputedStyle(el).fontSize) * 2) out.push(`wrapped: "${el.textContent?.trim()}"`);
                }
            }
            return out;
        }, mult);
        expect(faults, `text ×${mult}`).toEqual([]);
    }
});

test('operations: a person whose every row is a notice wears no count and no Skip all (v24.90)', async ({ page }) => {
    const other = secondReviewMember();
    await seedSession(page, 'G. Miller');
    await openRosterReview(page, { ...ROSTER_REVIEW_PARSE, parsed: [ROSTER_REVIEW_PARSE.parsed[0],
        { memberName: other.name, shifts: { ...other.base, [ROSTER_REVIEW_DATES[0]]: 'SICK' } }] });   // a Sunday absence
    const section = page.locator(`.roster-person-section[data-member="${other.name}"]`);
    await expect(section.locator('.roster-change-row.roster-change-guarded')).toHaveCount(1);
    await expect(section.locator('.roster-change-badge'), 'a "0" badge reads as an alert').toHaveCount(0);
    await expect(section.locator('.roster-skip-all-btn'), 'there is nothing to skip').toHaveCount(0);
    // A person with changes keeps both.
    const miller = page.locator('.roster-person-section[data-member="G. Miller"]');
    await expect(miller.locator('.roster-change-badge')).toHaveCount(1);
    await expect(miller.locator('.roster-skip-all-btn')).toHaveCount(1);
});

// An ANSWERED rest day writes (v24.42), and Skip all left the answer standing — so a skipped, inert
// section was still written by Save. The v21.94 bug, on the row type added after it. Driven to the
// write, because the counter and the collector are separate passes.
test('operations: Skip all takes back a "Swapped — record it" answer, so Save writes nothing for that person (v24.90)', async ({ page }) => {
    const other = secondReviewMember();
    await seedSession(page, 'G. Miller');
    await openRosterReview(page, { ...ROSTER_REVIEW_PARSE, choices: {}, parsed: [ROSTER_REVIEW_PARSE.parsed[0],
        { memberName: other.name, shifts: { ...other.base, [other.worked]: '05:00-13:00', [other.rest]: 'SICK' } }] });
    const section = page.locator(`.roster-person-section[data-member="${other.name}"]`);
    const guarded = section.locator('.roster-change-row.roster-change-guarded');
    await guarded.locator('[data-swap="yes"]').click();
    await expect(guarded.locator('.roster-act')).toHaveText('Will record');

    await section.locator('.roster-skip-all-btn').click();
    await expect(guarded.locator('.roster-act'), 'the answer is taken back').toHaveText('Not recorded');
    await expect(guarded.locator('[data-swap="yes"]')).toHaveAttribute('aria-pressed', 'false');
    // Restore does not answer it again: there is no safe default, which is why the row asks.
    await section.locator('.roster-skip-all-btn').click();
    await expect(guarded.locator('.roster-act')).toHaveText('Not recorded');
    await section.locator('.roster-skip-all-btn').click();

    await page.locator('#rosterApplyBtn').click();
    await expect.poll(() => page.evaluate(() => (window.__E2E?.batchWrites || []).length)).toBeGreaterThan(0);
    const theirs = await page.evaluate((n) => (window.__E2E?.batchWrites || []).filter(w => w.memberName === n), other.name);
    expect(theirs, 'a skipped person is written nothing — the swap included').toEqual([]);
});

// A person whose ONLY row asks the swap question had no Skip all: the button followed the count of
// pending rows, and a guarded row is not one — yet "Swapped — record it" made Save write for them, so
// the answer could be taken back only by finding the row again. The button now follows what Save
// could WRITE; the count badge still follows the pending rows, so this person wears no "0" (v24.96).
test('operations: a person whose only row asks the swap question gets a Skip all, and no count (v24.96)', async ({ page }) => {
    const other = secondReviewMember();
    await seedSession(page, 'G. Miller');
    await openRosterReview(page, { ...ROSTER_REVIEW_PARSE, choices: {}, parsed: [ROSTER_REVIEW_PARSE.parsed[0],
        { memberName: other.name, shifts: { ...other.base, [other.rest]: 'SICK' } }] });
    const section = page.locator(`.roster-person-section[data-member="${other.name}"]`);
    const guarded = section.locator('.roster-change-row.roster-change-guarded');
    await expect(guarded).toHaveCount(1);
    await expect(section.locator('.roster-change-badge'), 'nothing is pending, so no count').toHaveCount(0);
    await expect(section.locator('.roster-skip-all-btn'), 'an answer could be written, so it can be taken back').toHaveCount(1);
    await guarded.locator('[data-swap="yes"]').click();
    await expect(guarded.locator('.roster-act')).toHaveText('Will record');
    await section.locator('.roster-skip-all-btn').click();
    await expect(guarded.locator('.roster-act'), 'the answer is taken back').toHaveText('Not recorded');
});

// ── ANSWERING AN UNREADABLE CELL IN PLACE (v22.17) ────────────────────────────────────────────
//
// The composition rule is unit-tested in override-utils.test.mjs. What only a browser answers is
// whether the control REACHES the write — and that is the whole point of the feature, because the
// thing it replaces was a dead end that sent the admin to another page with a name and a date to
// remember. The batch mock records payloads, so these assert on what was WRITTEN.
test('operations: an unreadable cell can be answered in the review, and the entry is written', async ({ page }) => {
    await seedSession(page, 'G. Miller');
    await openRosterReview(page);

    const row = page.locator('.roster-change-row', { hasText: 'XZ9 GARBLED' });
    await row.locator('.roster-choice-btn--enter').click();
    await row.locator('.roster-entry-pill', { hasText: 'Shift' }).click();

    // An INCOMPLETE entry writes nothing and says so — the dangerous direction is a half-typed
    // time becoming a shift, because a half-typed time still looks like a time.
    await row.locator('.roster-entry-time[data-part="from"]').fill('06:00');
    await expect(row.locator('.roster-entry-hint')).toContainText('Enter both times');
    await expect(page.locator('#rosterApplyBtn')).toHaveText(/Save 3 changes/);

    await row.locator('.roster-entry-time[data-part="to"]').fill('14:00');
    await expect(row.locator('.roster-entry-hint')).toContainText('will be saved');
    // The row itself must stop saying "couldn't read — check the paper roster" while the summary
    // above counts it: the two used to disagree on screen, because the keystroke path patches the
    // row rather than re-rendering it (a re-render would destroy the field being typed into).
    await expect(row.locator('.roster-act')).toHaveText('Your entry');
    await expect(page.locator('#rosterApplyBtn')).toHaveText(/Save 4 changes/);

    await page.locator('#rosterApplyBtn').click();
    // The save's own receipt, not a 700ms sleep (test audit, 7 Nov 2026): it is written once every
    // batch has committed, so the writes are all recorded by then — and "exactly once" is a count
    // of a finished save rather than of however much of one had landed.
    await expect(page.locator('#rosterApplyFeedback')).toContainText('Done — 4 changes applied');
    const written = await page.evaluate(() =>
        (/** @type {any} */ (window).__E2E?.batchWrites || []).filter(/** @param {any} w */ w => w.date === '2026-08-05'));
    expect(written.length, 'the entered day must be written exactly once').toBe(1);
    expect(written[0].value).toBe('06:00-14:00');
    expect(written[0].type).toBe('shift');
    expect(written[0].source).toBe('roster_import');
});

test('operations: entry times typed without a colon are shaped into real times and written', async ({ page }) => {
    // The same keypad problem as the Links window: `manualCellValue` demands HH:MM, and a phone's
    // numeric keypad cannot type the colon, so "0600" left the cell at "Enter both times" for ever.
    await seedSession(page, 'G. Miller');
    await openRosterReview(page);
    const row = page.locator('.roster-change-row', { hasText: 'XZ9 GARBLED' });
    await row.locator('.roster-choice-btn--enter').click();
    await row.locator('.roster-entry-pill', { hasText: 'Shift' }).click();
    await row.locator('.roster-entry-time[data-part="from"]').pressSequentially('0600');
    await expect(row.locator('.roster-entry-time[data-part="from"]')).toHaveValue('06:00');
    await row.locator('.roster-entry-time[data-part="to"]').pressSequentially('1400');
    await expect(row.locator('.roster-entry-time[data-part="to"]')).toHaveValue('14:00');
    await expect(row.locator('.roster-entry-hint')).toContainText('will be saved');
    await page.locator('#rosterApplyBtn').click();
    // The save's receipt, not a 700ms sleep (test audit, 7 Nov 2026) — see the test above.
    await expect(page.locator('#rosterApplyFeedback')).toContainText(/Done — \d+ changes? applied/);
    const written = await page.evaluate(() =>
        (/** @type {any} */ (window).__E2E?.batchWrites || []).filter(/** @param {any} w */ w => w.date === '2026-08-05'));
    expect(written.map(/** @param {any} w */ w => w.value)).toEqual(['06:00-14:00']);
});

test('operations: an entered RDW is written as RDW, not as an ordinary shift', async ({ page }) => {
    // ADDED AFTER A SURVIVING MUTATION. Dropping the `RDW|` marker from `manualCellValue` left the
    // suite green, because the case above only ever enters a Shift. The marker is what makes
    // `shiftValueToOverrideType` write `rdw`, and the day is a WEDNESDAY on purpose: on a Sunday a
    // plain time is promoted to rdw anyway, so a Sunday case would pass with the marker gone and
    // prove nothing. This is money — a rest day worked is paid at a different rate.
    await seedSession(page, 'G. Miller');
    await openRosterReview(page);
    const row = page.locator('.roster-change-row', { hasText: 'XZ9 GARBLED' });
    await row.locator('.roster-choice-btn--enter').click();
    await row.locator('.roster-entry-pill', { hasText: /^RDW$/ }).click();
    await row.locator('.roster-entry-time[data-part="from"]').fill('09:00');
    await row.locator('.roster-entry-time[data-part="to"]').fill('17:00');
    await page.locator('#rosterApplyBtn').click();
    // The save's receipt, not a 700ms sleep (test audit, 7 Nov 2026) — see the test above.
    await expect(page.locator('#rosterApplyFeedback')).toContainText(/Done — \d+ changes? applied/);
    const written = await page.evaluate(() =>
        (/** @type {any} */ (window).__E2E?.batchWrites || []).filter(/** @param {any} w */ w => w.date === '2026-08-05'));
    expect(written.length).toBe(1);
    expect(written[0].type, 'a rest day worked must not be saved as an ordinary shift').toBe('rdw');
    // The stored value is the bare time — the RDW-ness lives in `type`, as it does everywhere else.
    expect(written[0].value).toBe('09:00-17:00');
});

// The summary is counted from the Save's own writes now (whole-app fix, Nov 2026), and the entry
// control is the one that knows an unreadable cell was ANSWERED with nothing to record — it is handed
// to the count. Without it, "Rest day — leave it" went on being reported as a cell nobody could read.
test('operations: leave entered on a rest day and answered "Rest day" is an answer, not an unread cell', async ({ page }) => {
    await seedSession(page, 'G. Miller');
    const me = teamMembers.find(m => m.name === 'G. Miller');
    const base = (/** @type {string} */ d) => getBaseShift(me, new Date(d + 'T12:00:00'));
    const rest = ROSTER_REVIEW_DATES.slice(1).find(d => base(d) === 'RD');
    test.skip(!rest, 'G. Miller has no weekday rest day in the fixture week');
    const shifts = Object.fromEntries(ROSTER_REVIEW_DATES.map(d => [d, base(d)]));
    shifts[/** @type {string} */ (rest)] = 'UNKNOWN|SEE CEM';
    await openRosterReview(page, { weekEnding: '2026-08-08', rosterType: 'cea', dates: ROSTER_REVIEW_DATES,
        crossCheck: 'complete', missingMembers: [], choices: {}, geometry: { status: 'complete' },
        parsed: [{ memberName: 'G. Miller', shifts }] }, { noSavedEntries: true });
    const outcome = page.locator('#rosterOutcome');
    await expect(outcome).toContainText("1 cell couldn't be read");
    const row = page.locator('.roster-change-row', { hasText: 'SEE CEM' });
    await row.locator('.roster-choice-btn--enter').click();
    await row.locator('.roster-entry-pill', { hasText: /^AL$/ }).click();
    await row.locator('.roster-entry-swap-btn[data-entry-swap="no"]').click();
    await expect(row.locator('.roster-act')).toHaveText('Not recorded');
    await expect(outcome).not.toContainText("couldn't be read");
});

test('operations: the entry control never offers a type Sunday forbids', async ({ page }) => {
    // Sunday is uncontracted, so AL, Absent and a plain Shift may never be written to one — six
    // numbered enforcement layers say so, and this control consults that list rather than keeping
    // a seventh copy. RDW is the type that BELONGS on a Sunday and must stay available.
    await seedSession(page, 'G. Miller');
    await openRosterReview(page, {
        weekEnding: '2026-08-08', rosterType: 'cea', dates: ROSTER_REVIEW_DATES,
        crossCheck: 'complete', missingMembers: [], choices: {},
        parsed: [{ memberName: 'G. Miller', shifts: { '2026-08-02': 'UNKNOWN|SMUDGE' } }],
    });
    const row = page.locator('.roster-change-row', { hasText: 'SMUDGE' });
    await row.locator('.roster-choice-btn--enter').click();
    for (const label of ['AL', 'Absent', 'Shift']) {
        await expect(row.locator('.roster-entry-pill', { hasText: new RegExp(`^${label}$`) }))
            .toBeDisabled();
    }
    await expect(row.locator('.roster-entry-pill', { hasText: /^RDW$/ })).toBeEnabled();
    await expect(row.locator('.roster-entry-pill', { hasText: /^Rest Day$/ })).toBeEnabled();
});

test('operations: an options row keeps its own words while an entry is half-finished', async ({ page }) => {
    // TWO ROW SHAPES share `patchEntryRow` and they do not share a vocabulary. The row that offers
    // candidate readings calls its control "Neither — enter it"; the row with no readings says
    // "Enter the shift". `patchEntryRow` spoke only the second row's dialect, so on an options row
    // an incomplete draft renamed the open control to the OTHER row's phrase. Latent since v22.17
    // (only the keystroke path reached it); v22.50 routed every pill click through the same call,
    // so it fired on the first tap.
    //
    // The TAG follows one rule on both shapes since polish round 2 (owner-approved): the
    // "couldn't read" style until something will be written, the decision style once it will. So a
    // half-finished draft on an unanswered row is still `act-read` — and a row whose READING is
    // picked stays `act-choice` while a half-finished entry sits open beside it.
    await seedSession(page, 'G. Miller');
    await openRosterReview(page);
    const row = page.locator('.roster-change-row', { has: page.locator('.roster-choice-btn--skip') })
        .filter({ has: page.locator('.roster-choice-btn--enter') }).first();
    const btn = row.locator('.roster-choice-btn--enter');
    const tag = row.locator('.roster-act');
    await expect(btn).toHaveText('Neither — enter it');
    await expect(tag).toHaveClass(/act-read/);
    await btn.click();

    // Half-finished: Other with no flavour yet composes to nothing, so `done` is false.
    await row.locator('.roster-entry-pill', { hasText: /^Other$/ }).click();
    await expect(btn).toHaveText('Neither — enter it');          // NOT "Enter the shift"
    await expect(tag).toHaveClass(/act-read/);
    await expect(tag).toHaveText("Couldn't read");

    // Finished: the shared "Entered — change it" is correct on both shapes.
    await row.locator('.roster-entry-flavour', { hasText: 'Training' }).click();
    await expect(btn).toHaveText('Entered — change it');
    await expect(tag).toHaveClass(/act-choice/);
    await expect(tag).not.toHaveClass(/act-read/);
    await expect(row.locator('.roster-entry-hint')).toContainText('will be saved');

    // A picked READING, then the entry un-finished beside it: still answered, and it says so. Picking
    // the reading closes the editor (whole-app fix, Nov 2026), so it is opened again to un-finish it.
    await row.locator('.roster-choice-btn[data-opt="0"]').click();
    await btn.click();
    await row.locator('.roster-entry-pill', { hasText: /^Other$/ }).click();
    await expect(tag).toHaveClass(/act-choice/);
    await expect(tag).toHaveText('Your choice');
});

// Whole-app fix, Nov 2026 (import-client-2): an options row was patched in place by four paths that
// each updated a different subset, so Skip stayed lit beside a finished entry, a picked reading stayed
// lit while Save wrote the entry typed after it, and Skip left an editor saying "this day will be
// saved". One painter now applies the render's rules on every path; what is lit is what Save writes.
test('operations: an options row lights only the answer Save will write, and Skip closes the editor', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await seedSession(page, 'G. Miller');
    await openRosterReview(page);
    const row = page.locator('.roster-change-row[data-key="G. Miller|2026-08-07"]');   // readings: AL · Rest
    const reading = row.locator('.roster-choice-btn[data-opt="0"]');
    const skip = row.locator('.roster-choice-btn--skip');
    const enter = row.locator('.roster-choice-btn--enter');
    const lit = async (/** @type {string[]} */ on) => {
        for (const [name, b] of /** @type {const} */ ([['reading', reading], ['skip', skip], ['enter', enter]])) {
            await expect(b, name).toHaveAttribute('aria-pressed', String(on.includes(name)));
        }
    };
    await lit(['skip']);

    // (a) An entry finished: the entry is the answer, and Skip goes out.
    await enter.click();
    await row.locator('.roster-entry-pill', { hasText: /^Absent$/ }).click();
    await lit(['enter']);
    await expect(enter).toHaveText('Entered — change it');

    // (d) A reading picked after it: the reading is the answer, and the editor beside it goes.
    await reading.click();
    await lit(['reading']);
    await expect(row.locator('.roster-entry')).toHaveCount(0);
    await expect(enter).toHaveText('Neither — enter it');

    // (c) An entry finished after the reading: the reading goes out.
    await enter.click();
    await row.locator('.roster-entry-pill', { hasText: /^Absent$/ }).click();
    await lit(['enter']);

    // (b) Skip: nothing is the answer, and the editor closes as Skip all closes it.
    await skip.click();
    await lit(['skip']);
    await expect(row.locator('.roster-entry')).toHaveCount(0);
    await expect(enter).toHaveText('Neither — enter it');
    await expect(row.locator('.roster-act')).toHaveText("Couldn't read");

    // What is lit is what is written: the reading, once, and nothing else for the day.
    await reading.click();
    await page.locator('#rosterApplyBtn').click();
    await expect(page.locator('#rosterApplyFeedback')).toContainText('Done — 4 changes applied');
    const written = await page.evaluate(() => (/** @type {any} */ (window).__E2E.batchWrites || [])
        .filter((/** @type {any} */ w) => w.date === '2026-08-07').map((/** @type {any} */ w) => [w.type, w.value]));
    expect(written).toEqual([['annual_leave', 'AL']]);
});

// Whole-app fix, Nov 2026 (import-client-14): the editor is redrawn on every press inside it, and the
// pressed control was one of the elements replaced — so keyboard focus fell to the page body on every
// pill, chip and answer. It now lands on the same control in the new editor.
test('operations: a key press inside the entry editor keeps focus on the control pressed', async ({ page }) => {
    await seedSession(page, 'G. Miller');
    await openRosterReview(page);
    const row = page.locator('.roster-change-row', { hasText: 'XZ9 GARBLED' });
    await row.locator('.roster-choice-btn--enter').focus();
    await page.keyboard.press('Enter');
    const pill = row.locator('.roster-entry-pill[data-entry-type="other"]');
    await pill.focus();
    await page.keyboard.press('Enter');
    await expect(row.locator('.roster-entry-pill[data-entry-type="other"]')).toBeFocused();
    const chip = row.locator('.roster-entry-flavour').first();
    await chip.focus();
    await page.keyboard.press('Space');
    await expect(row.locator('.roster-entry-flavour').first()).toBeFocused();
    await expect(row.locator('.roster-entry-flavour').first()).toHaveAttribute('aria-pressed', 'true');
});

test('operations: App speed states the stored-copy share against the versions that can count it', async ({ page }) => {
    /*
     * THE WIRING for the v24.89 fix (the 48-hour review). The share is pinned in perf-stats.test.mjs;
     * what it cannot see is the card using it. The card used to divide by `ready` across EVERY
     * version, so in the month the copy began to be counted, three weeks of opens from versions that
     * cannot report one sat under it: 360 copies over 1,900 opens printed 19%, when the 600 opens
     * that could have reported one make it 60%.
     */
    await page.addInitScript(() => {
        window.__E2E = { ...(window.__E2E || {}), getDocData: { samples: {
            '24_84|calendar|ready|lt500ms|standalone|4g':          1300,
            '24_85|calendar|ready|lt500ms|standalone|4g':           600,
            '24_85|calendar|rosterSnapshot|lt500ms|standalone|4g':  360,
            '24_84|calendar|domReady|lt500ms|standalone|4g':       1300,
            '24_85|calendar|domReady|lt500ms|standalone|4g':        600,
        } } };
    });
    await seedSession(page, 'G. Miller');
    await page.goto('/operations.html');
    const speed = page.locator('#pageSpeedContent');
    await expect(speed).toContainText('Before the sign-in check');
    // It names the group it divides by — "Usable" opens on the versions that record a copy — which it
    // got wrong ("Calendar opens") until the App Speed review.
    await expect(speed).toContainText(/60% of the opens counted under “Usable” (this|last) month, on versions that record it/);
    await expect(speed, 'the all-version divisor — the figure this fixes').not.toContainText('19%');
});

test('operations: App speed shows no stored-copy block when no copy was shown', async ({ page }) => {
    await page.addInitScript(() => {
        window.__E2E = { ...(window.__E2E || {}), getDocData: { samples: {
            '24_84|calendar|ready|lt500ms|standalone|4g':  600,
            '24_84|calendar|ready|1-3s|browser|4g':         60,
            '24_84|calendar|domReady|lt500ms|standalone|4g': 660,
        } } };
    });
    await seedSession(page, 'G. Miller');
    await page.goto('/operations.html');
    const speed = page.locator('#pageSpeedContent');
    await expect(speed).toContainText('By how it was opened — Usable');   // the closer look rendered
    await expect(speed).not.toContainText('Before the sign-in check');
});

test('operations: App speed times the wait after a release, from the version that times it', async ({ page }) => {
    /*
     * THE RULE TESTED, THE WIRING NOT — this is the wiring. The recorder's half is pinned in
     * perf-reporter.test.mjs and the version floor in perf-stats.test.mjs; what neither sees is the
     * card reading THIS page's waits, from the version that times a wait, and saying so.
     *
     * The numbers make a wrong read visible: the row must count 36 — not 436 (the older version's
     * background loads folded in), and not 186 (paycalc's added). And it states NO share of the
     * opens above any more: a reload nobody watched is not in "Usable", so the ratio meant nothing.
     */
    await page.addInitScript(() => {
        window.__E2E = { ...(window.__E2E || {}), getDocData: { samples: {
            '24_97|calendar|readyUpdate|3-8s|standalone|4g':     400,
            '24_98|calendar|readyUpdate|lt500ms|standalone|4g':   30,
            '24_98|calendar|readyUpdate|1-3s|standalone|4g':       6,
            '24_98|paycalc|readyUpdate|1-3s|standalone|4g':      150,
            '24_98|calendar|ready|lt500ms|standalone|4g':        600,
            '24_98|calendar|domReady|lt500ms|standalone|4g':     600,
            '24_98|paycalc|domReady|lt500ms|standalone|4g':      300,
        } } };
    });
    await seedSession(page, 'G. Miller');
    await page.goto('/operations.html');
    const speed = page.locator('#pageSpeedContent');
    await expect(speed).toContainText('After a release');
    await expect(speed).toContainText('Counted from v24.98');
    await expect(speed).not.toContainText('That is');
    await expect(speed).not.toContainText('also counted in');
    const row = speed.locator('.speed-row--why', { hasText: 'Until usable' }).first();
    await expect(row.locator('.speed-row-sub')).toHaveText(/^36\b/);
    await expect(row.locator('.speed-row-count')).toHaveText(/^17%/);       // 6 of 36 over a second
    await expect(row.locator('.speed-row-expl')).toContainText('from coming back to the page');
});

// ── Staff Login Accounts: the provisioning audit (v22.53) ───────────────────────────────────────
//
// The rule is unit-tested next door and the card's own decisions in admin-auth.test.mjs; what only
// a browser answers is that the real card, on a real page load, reaches the endpoint and puts the
// answer where the admin will see it — including into the strip, which lives in a different module
// and is fed by a callback nothing else exercises end to end.
//
// The second test is the one worth having. The endpoint is UNREACHABLE in every other spec in this
// file (no route is registered, so the call simply fails), which means every one of them is already
// exercising the failure path — and the "clean page has NO attention strip" test above passes
// BECAUSE the audit reports nothing when it does not know. That is the intended behaviour and it is
// also indistinguishable from the audit not being wired at all, so it gets an assertion of its own
// rather than being left as a happy accident.

const GAPS_URL = 'https://europe-west2-myb-roster.cloudfunctions.net/getAccountSetupGaps';

test('operations: account gaps reach the card BY NAME and the strip by group', async ({ page }) => {
    await seedSession(page);
    await page.addInitScript(() => { window.__E2E = { ...(window.__E2E || {}), authUser: true }; });
    await page.route(GAPS_URL, route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({
            setUp: [{ name: 'B. Toth', why: 'no-account' }, { name: 'S. Silva', why: 'claims' }],
            leavers: ['B. Khalil'],
        }),
    }));
    await page.goto('/operations.html');

    // The journey in order: the strip is what an admin sees first, because the card it points at is
    // collapsed like every other card on this page — which is the whole reason the strip exists.
    const strip = page.locator('#attentionStrip');
    await expect(strip).toBeVisible();
    await expect(strip.getByRole('link', { name: 'Not set up: 2 members' })).toBeVisible();
    await expect(strip.getByRole('link', { name: 'Leavers still active: 1' })).toBeVisible();

    await expect(page.locator('#authSetupBody')).not.toHaveClass(/open/);
    await strip.locator('a[href="#login-accounts"]').first().click();
    await expect(page.locator('#authSetupBody')).toHaveClass(/open/);

    const gaps = page.locator('#authSetupGaps');
    await expect(gaps).toBeVisible();
    await expect(gaps).toContainText('B. Toth (no account)');
    await expect(gaps).toContainText('S. Silva (wrong permissions)');
    await expect(gaps).toContainText('B. Khalil');
    // Each line names the button that fixes it — the grouping is BY REMEDY, so a group that does
    // not state its remedy has thrown away the reason for grouping that way.
    await expect(gaps).toContainText('Press Set up accounts below');
    await expect(gaps).toContainText('Tick the leavers box below');
});

test('operations: an audit that could not run reports NOTHING, rather than a clean bill', async ({ page }) => {
    await seedSession(page);
    // `authUser` is LOAD-BEARING here, not boilerplate. The Firebase stub leaves currentUser null by
    // default, so the client wrapper throws "Not signed in" before it ever fetches — and this test
    // passed on that, with the aborted route never reached. Measured. Without the opt-in it asserts
    // that an unauthenticated read fails, which is a different and far less interesting sentence.
    await page.addInitScript(() => { window.__E2E = { ...(window.__E2E || {}), authUser: true }; });
    await page.route(GAPS_URL, route => route.abort('failed'));
    await page.goto('/operations.html');

    // The card says so — a silent failure would read exactly like a tick.
    await expect(page.locator('#authSetupGaps')).toContainText('Couldn’t check');
    // …and the strip stays away. Reporting a zero here would put "nothing needs attention" on the
    // page on the authority of a request that never completed.
    await expect(page.locator('#attentionStrip')).toBeHidden();
});

test('operations: a fully provisioned roster says so, and still adds no strip item', async ({ page }) => {
    await seedSession(page);
    await page.addInitScript(() => { window.__E2E = { ...(window.__E2E || {}), authUser: true }; });
    await page.route(GAPS_URL, route => route.fulfill({
        status: 200, contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({ setUp: [], leavers: [] }),
    }));
    await page.goto('/operations.html');
    await expect(page.locator('#authSetupGaps')).toContainText('Everyone on the roster has a login');
    await expect(page.locator('#attentionStrip')).toBeHidden();
});

// CONFIRMING THE LEAVER DISABLE KEEPS THE FIRST RUN'S REPORT (whole-app review, Oct 2026). The
// confirm re-rendered the result box, wiping the "taken back — tell them" names that only the admin
// can act on. The confirm's own outcome is APPENDED, without the re-run's whole-roster "already
// existed" list.
test('operations: confirming the leaver disable keeps the first run\'s report', async ({ page }) => {
    await seedSession(page);
    await page.addInitScript(() => { window.__E2E = { ...(window.__E2E || {}), authUser: true }; });
    await page.route(GAPS_URL, route => route.fulfill({
        status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({ setUp: [], leavers: ['B. Khalil'] }),
    }));
    let calls = 0;
    await page.route('**/setupRosterAuth', route => {
        calls++;
        const body = calls === 1
            ? { skipped: ['G. Miller'], reclaimed: ['S. Silva'], orphanDryRun: true, orphansToDisable: ['B. Khalil'] }
            : { skipped: ['G. Miller', 'S. Silva'], disabled: ['B. Khalil'] };
        return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
    });
    await page.goto('/operations.html');
    await page.locator('#authSetupToggleHeader').click();
    await page.locator('#authSetupOrphans').check();
    await page.locator('#authSetupBtn').click();
    const result = page.locator('#authSetupResult');
    await expect(result).toContainText('Taken back and reset to the default password (1): S. Silva');
    await page.locator('#authConfirmOrphans').click();
    await expect(result).toContainText('Disabled leavers (1): B. Khalil');
    await expect(result, 'the names only the admin can act on must survive the confirm').toContainText('S. Silva — tell them their password is their surname');
    await expect(result.locator('text=Already existed'), 'the re-run lists the whole roster again; it is not appended').toHaveCount(1);
    await expect(page.locator('#authConfirmOrphans')).toHaveCount(0);
});

// ── A ROSTER READ CUT OFF IN TRANSIT SAYS SO (7 Nov 2026, iPhone audit) ─────────────────────────
// Safari reports every network failure as "Load failed", and the import read that as a slow parse —
// "The PDF may be large" — so an admin whose phone lost its signal, or who left the screen while the
// read ran, was sent to shrink a PDF that was fine. The words are pinned in
// admin-roster-upload.test.mjs; these drive the real button, so what the handler hands the rule —
// the time the read started, `navigator.onLine` — is what is tested.
test.describe('operations: the roster read, cut off', () => {
    /** Open the upload card and choose a PDF. @param {import('@playwright/test').Page} page */
    async function choosePdf(page) {
        await page.evaluate(() => {
            const b = document.getElementById('rosterUploadBody');
            if (b && !b.classList.contains('open')) document.getElementById('rosterUploadToggleHeader')?.click();
        });
        await page.setInputFiles('#rosterFileInput',
            { name: 'roster.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 fixture') });
    }

    test('while it reads, the admin is told to keep the screen open', async ({ page }) => {
        await seedSession(page, 'G. Miller');
        await page.route('**/parseRosterPDF*', () => { /* never answered: the read is still running */ });
        await page.goto('/operations.html');
        await choosePdf(page);
        await page.locator('#rosterParseBtn').click();
        await expect(page.locator('#rosterParseFeedback')).toHaveText(
            'Reading the PDF — this takes about 15 seconds. Keep this screen open until it finishes.');
    });

    // Whole-app fix, Nov 2026 (import-client-12): the form is locked while a read is out, but the
    // week sits behind the date picker's trigger, which ignores its input's `disabled` — so a week
    // picked mid-read changed the form while the review that came back was for the week SENT. The
    // picker sets the value and fires `change` (date-picker.js's contract), which is what this does.
    test('a week picked while the read is out is put back — the form keeps the week that was sent', async ({ page }) => {
        await seedSession(page, 'G. Miller');
        await page.route('**/parseRosterPDF*', () => { /* never answered: the read is still running */ });
        await page.goto('/operations.html');
        await choosePdf(page);
        const week = page.locator('#rosterWeekEnding');
        const pick = (/** @type {string} */ iso) => week.evaluate((el, v) => {
            /** @type {HTMLInputElement} */ (el).value = v;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
        }, iso);
        await pick('2026-08-08');
        await page.locator('#rosterParseBtn').click();
        await expect(page.locator('#rosterParseBtn')).toHaveText('Reading…');
        await pick('2026-08-15');
        await expect(week).toHaveValue('2026-08-08');
        await expect(page.locator('#rosterUploadBody .date-trigger')).toHaveText(/Sat 8 Aug 2026/);
    });

    test('Safari\'s "Load failed" seconds in is a dropped connection, not a large PDF', async ({ page }) => {
        await seedSession(page, 'G. Miller');
        // Safari's own words for a network failure, at once — no read can have been slow by then.
        await page.addInitScript(() => {
            const real = window.fetch;
            window.fetch = (input, init) => (String(input instanceof Request ? input.url : input).includes('parseRosterPDF')
                ? Promise.reject(new TypeError('Load failed')) : real(input, init));
        });
        await page.goto('/operations.html');
        await choosePdf(page);
        await page.locator('#rosterParseBtn').click();
        const feedback = page.locator('#rosterParseFeedback');
        await expect(feedback).toContainText("Couldn't read the roster: The connection dropped before it finished.");
        await expect(feedback).toContainText('keep this screen open');
        await expect(feedback).not.toContainText('may be large');
        await expect(page.locator('#rosterParseBtn'), 'the admin can try again at once').toBeEnabled();
    });

    test('offline, any failure is the connection — whatever the browser calls it', async ({ page }) => {
        await seedSession(page, 'G. Miller');
        await page.goto('/operations.html');
        await choosePdf(page);
        await page.context().setOffline(true);
        await page.locator('#rosterParseBtn').click();
        await expect(page.locator('#rosterParseFeedback')).toContainText('The connection dropped before it finished.');
        await page.context().setOffline(false);
    });

    // Whole-app fix, Nov 2026 (import-client-10): a parse that runs past the function's own limit is
    // answered by the platform, not the handler — a gateway error whose body is not JSON — and it was
    // reported as "Unexpected error — please try again or contact support". There is no support.
    test('a gateway timeout with no words of its own says the read took too long', async ({ page }) => {
        await seedSession(page, 'G. Miller');
        await page.route('**/parseRosterPDF*', route => route.fulfill({ status: 504, contentType: 'text/plain', body: 'upstream request timeout' }));
        await page.goto('/operations.html');
        await choosePdf(page);
        await page.locator('#rosterParseBtn').click();
        const feedback = page.locator('#rosterParseFeedback');
        await expect(feedback).toContainText("Couldn't read the roster: The server stopped the read because it took too long.");
        await expect(feedback).not.toContainText('support');
    });

    // …and a body that STALLS after its headers (the pwa review's lead): the bound was cleared when
    // the headers arrived, so `response.json()` waited for ever with the form locked on "Reading…".
    // The stand-in's body read rejects with an AbortError when the request's signal aborts — what a
    // real fetch does (a ReadableStream errored by hand reaches `json()` as "Failed to fetch" instead).
    test('a reply whose body stalls is still ended by the read\'s own bound', async ({ page }) => {
        await page.clock.install({ time: new Date('2026-11-10T10:00:00Z') });
        await seedSession(page, 'G. Miller');
        await page.addInitScript(() => {
            const real = window.fetch;
            /** @type {any} */ (window).fetch = (/** @type {any} */ input, /** @type {any} */ init) => {
                if (!String(input instanceof Request ? input.url : input).includes('parseRosterPDF')) return real(input, init);
                const json = () => new Promise((_, reject) => init?.signal?.addEventListener('abort',
                    () => reject(new DOMException('The operation was aborted.', 'AbortError'))));
                return Promise.resolve({ ok: true, status: 200, json });
            };
        });
        await page.goto('/operations.html');
        await choosePdf(page);
        await page.locator('#rosterParseBtn').click();
        await expect(page.locator('#rosterParseBtn')).toHaveText('Reading…');
        await page.clock.runFor(131_000);
        await expect(page.locator('#rosterParseFeedback')).toContainText("Couldn't read the roster: Parsing took longer than expected.");
        await expect(page.locator('#rosterParseBtn')).toHaveText('Read roster');
    });
});

// ── THE DESKTOP AUDIT (Nov 2026) ─────────────────────────────────────────────────────────────────
// Operations at the station PC's size. Geometry and computed style, because each defect here was
// invisible to a behavioural assertion: every row and button was present and correct, and the page
// was 4,617px of account rows, or its focus ring could not be seen.

test('operations: with a mouse, each account is ONE line, its email at one x down the list, and the row does not pretend to be clickable', async ({ page }, info) => {
    // Two lines per member — the head over the email line, sized for a thumb at 375px — made Account
    // status 4,617px tall at every desktop width. And each row's border changed under the pointer
    // though nothing on the row is a target except its buttons.
    test.skip(isTouchProject(info), 'a desk-sized window and a mouse');
    await page.setViewportSize({ width: 1366, height: 900 });
    await seedSession(page);
    await seedMember(page);
    await page.goto('/operations.html');
    await expect(page.locator('#accountStatusCard')).toBeVisible({ timeout: 10000 });
    await page.evaluate(() => /** @type {HTMLElement|null} */ (
        document.querySelector('#accountStatusCard .card-header-toggle'))?.click());
    await expect(page.locator('.acct-row').first()).toBeVisible();
    const rows = await page.evaluate(() => [...document.querySelectorAll('.acct-row')].map(r => {
        const head = /** @type {HTMLElement} */ (r.querySelector('.acct-row-head')).getBoundingClientRect();
        const mail = /** @type {HTMLElement} */ (r.querySelector('.acct-row-email')).getBoundingClientRect();
        return { h: Math.round(r.getBoundingClientRect().height), sameLine: Math.abs(head.top - mail.top) < 4 && mail.left > head.right,
                 mailX: Math.round(mail.left) };
    }));
    expect(rows.length, 'premise: the card lists the roster').toBeGreaterThan(10);
    expect(rows.filter(r => !r.sameLine).length, 'every member is one line: name, password and Reset, then the email').toBe(0);
    expect(Math.max(...rows.map(r => r.h)), 'so no row is two lines tall').toBeLessThan(50);
    expect(new Set(rows.map(r => r.mailX)).size, 'every email starts at the same x').toBe(1);
    // Not a control, so nothing changes under the pointer.
    const row = page.locator('.acct-row').nth(3);
    const edge = () => row.evaluate(el => getComputedStyle(el).borderTopColor);
    await page.mouse.move(2, 2);
    const resting = await edge();
    const box = /** @type {{x:number,y:number,width:number,height:number}} */ (await row.boundingBox());
    await page.mouse.move(box.x + 4, box.y + box.height / 2);
    // Two frames for a hover to take effect, then until no transition is running: "did not change"
    // passes trivially on a read taken before the change began.
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    await expect.poll(() => row.evaluate(el => el.getAnimations().length)).toBe(0);
    expect(await edge(), 'the row\'s edge does not answer the pointer').toBe(resting);
});

test('operations: the upload and Read roster buttons take the navy ring on the white card, not the gold one', async ({ page }, info) => {
    // Gold is ~1.5:1 on a light surface — under the 3:1 a focus indicator needs. The ring is drawn
    // only for a keyboard, so no screenshot sees it: this reads the outline each button actually gets.
    test.skip(isTouchProject(info), 'a keyboard ring');
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.addInitScript(() => { /** @type {any} */ (window).__E2E = { authUser: true, docs: [] }; });
    await seedSession(page, 'G. Miller');
    await page.goto('/operations.html');
    await expect(page.locator('#huddleUploadBtn')).toBeVisible({ timeout: 10000 });
    const navy = await page.evaluate(() => {
        const el = document.createElement('i'); el.style.color = 'var(--primary-blue)'; document.body.append(el);
        const c = getComputedStyle(el).color; el.remove(); return c;
    });
    // They are disabled until a file is chosen; the ring is the subject here, so they are let in.
    await page.evaluate(() => ['huddleUploadBtn', 'circularUploadBtn', 'newsletterUploadBtn', 'rosterParseBtn']
        .forEach(id => { const b = /** @type {HTMLButtonElement|null} */ (document.getElementById(id)); if (b) b.disabled = false; }));
    await page.keyboard.press('Tab');
    for (const id of ['huddleUploadBtn', 'rosterParseBtn']) {
        const btn = page.locator(`#${id}`);
        await btn.evaluate(el => el.closest('.card-collapsible-body')?.classList.add('open'));
        await btn.focus();
        expect(await btn.evaluate(el => ({ visible: el.matches(':focus-visible'), colour: getComputedStyle(el).outlineColor })),
            `#${id}'s ring is the light-surface navy`).toEqual({ visible: true, colour: navy });
    }
});

test('operations: the small things on a desk — the file button matches its field, and a capped hint does not orphan a word', async ({ page }, info) => {
    test.skip(isTouchProject(info), 'the desk layout');
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.addInitScript(() => { /** @type {any} */ (window).__E2E = { authUser: true, docs: [] }; });
    await seedSession(page, 'G. Miller');
    await page.goto('/operations.html');
    await page.evaluate(() => document.getElementById('circularUploadBody')?.classList.add('open'));
    const label = page.locator('label[for="circularFileInput"]');
    const field = page.locator('#circularUploadBody .date-trigger');
    await expect(field).toBeVisible({ timeout: 10000 });
    const edge = (/** @type {import('@playwright/test').Locator} */ loc) => loc.evaluate(el => {
        const cs = getComputedStyle(el); return { radius: cs.borderTopLeftRadius, width: cs.borderTopWidth, colour: cs.borderTopColor };
    });
    expect(await edge(label), '"Choose file" wears the corner and edge of the date field beside it').toEqual(await edge(field));
    // Where the engine has it: `pretty` is progressive, and an engine without it wraps as before.
    if (await page.evaluate(() => CSS.supports('text-wrap-style', 'pretty'))) {
        expect(await page.locator('#errorLogCard .hint').evaluate(el => getComputedStyle(el).textWrapStyle),
            'a capped card hint balances its last lines').toBe('pretty');
    }
    await expect(page.locator('#errorLogCard .hint'), 'and names no touch verb on a desk').not.toContainText(/\btap\b/i);
});
