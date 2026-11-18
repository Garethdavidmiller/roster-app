/**
 * operations.spec.js — Operations (operations.html): usage and speed cards, reset requests, account status, attention strip.
 *
 * Split out of pages.spec.js on 3 Nov 2026, test for test and unchanged: the tests that span
 * pages, and the shared drawer, dialogs and sheets, stay there.
 */
import { test, expect, isoDaysAgo } from './fixtures.js';
import { NEWSLETTER_LATEST_KEY } from '../newsletter-recency.js';
import AxeBuilder from '@axe-core/playwright';
import { collectFatalErrors, seedSession, seedMember, openRosterReview, stubPerfReads, perfSamples, stubUsageReads, usageStats, ROSTER_REVIEW_DATES, ROSTER_REVIEW_PARSE, isTouchProject } from './helpers.js';
import { teamMembers, getBaseShift } from '../roster-data.js';
import { LOST_PHONE } from '../operations-reset.js';
import { alSheetFixture } from './al-sheet-fixture.js';
import { describeRefusal } from '../al-leave-file.js';
import { manualOverrideId } from '../override-id.js';
import { dayLabel, appWords, chipsFor, totalsEntries, CARD_WORDS, checkedWords, overallWords, appOnlyWords,
    moreDaysWords, notComparedWords, beyondHeadWords, SAVE_WORDS, questionWords, confirmWords, saveButtonWords, receiptWords,
    refusalWords, undoConfirmWords, undoneWords, savingWords, leftFreeWords } from '../al-leave-words.js';
import { LEAVE_FILE_MAX_AGE_DAYS, LEAVE_FILE_MAX_BYTES } from '../al-leave-file.js';
import { writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseISODate } from '../roster-data.js';

// ── OPERATIONS (operations.html) ──────────────────────────────────────────

test('operations: shows the in-place login when not signed in', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.goto('/operations.html');
    // No redirect any more (Option B) — the shared login overlay is injected in place.
    await expect(page).toHaveURL(/operations\.html/);
    await expect(page.locator('#loginOverlay')).toBeVisible();
    expect(errors, 'Uncaught JS exceptions triggering operations redirect').toHaveLength(0);
});

// ── NOT ADMIN'S SAVED-CHANGES MACHINERY (Nov 2026 review, import-client-11's Operations half) ────
// Operations imported admin-overrides.js for one function, loadOverrides, which returns at once on this
// page (it has no member picker and no Saved Changes list) — and the import brought a dozen of Admin's
// modules with it. The roster import's re-read is an explicit no-op here now, and none of them loads.
// The Annual leave sheet's Save writes through Admin's own checked commit, and loads the store only once
// a check offers a Save (al-leave-save.js → preloadSaveStore), so a page load loads none of it.
test('operations: the page loads none of Admin\'s saved-changes modules', async ({ page }) => {
    const loaded = [];
    page.on('request', r => { const m = /\/(admin-[a-z-]+)\.js(?:\?|$)/.exec(r.url()); if (m) loaded.push(m[1]); });
    await seedSession(page, 'G. Miller');
    await page.goto('/operations.html');
    await expect(page.locator('#rosterUploadCard')).toBeVisible();
    expect(loaded, 'premise: the roster import still loads').toContain('admin-roster-upload');
    expect(loaded.filter(f => /^admin-(overrides|override-store|saved-changes|week-editor)$/.test(f))).toEqual([]);
});

// AN EMPTY STATUS LINE TAKES NO ROOM (laptop polish, 13 Nov 2026). Every upload card ends in a status line
// that is empty until something is said, and its 10px margin made an open card end 22px under its
// controls where it starts 12px over them. It stays in the page — it is a live region — and only its
// margin goes; when it speaks, the gap comes back with it.
test('operations: an open upload card ends as close under its controls as it starts over them', async ({ page }) => {
    await seedSession(page, 'G. Miller');
    await page.goto('/operations.html');
    const fb = page.locator('#huddleFeedback');
    await expect(page.locator('#huddleUploadBtn')).toBeVisible();
    const gap = () => page.evaluate(() => {
        const btn = /** @type {Element} */ (document.getElementById('huddleUploadBtn')).getBoundingClientRect();
        const body = /** @type {Element} */ (document.getElementById('huddleFeedback')).parentElement?.getBoundingClientRect();
        return Math.round((body?.bottom ?? 0) - btn.bottom);
    });
    expect(await fb.evaluate(el => el.childNodes.length), 'premise: nothing has been said yet').toBe(0);
    const quiet = await gap();
    await fb.evaluate(el => { el.textContent = 'Uploaded.'; });
    const said = await gap();
    expect(said - quiet, 'a status line that speaks keeps its gap above it').toBeGreaterThanOrEqual(10 + 12);
    await fb.evaluate(el => { el.textContent = ''; });
    expect(await gap(), 'an empty one adds nothing under the button').toBe(quiet);
    expect(await fb.evaluate(el => getComputedStyle(el).marginTop)).toBe('0px');
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
    await expect(note).toContainText('Since late October 2026 the app leaves out');   // when, in the admin's words (18 Nov 2026)
    await expect(note, 'a version number is developer-speak in the admin\'s copy').not.toContainText('v24.98');
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
                { id: 'O. Mylla',       requestedAt: Date.now() - 30 * 60_000,   count: 1, provisioned: true, disabled: true },
            ] };
        });
        await seedSession(page, 'G. Miller');
        await page.goto('/operations.html');

        const rows = page.locator('.rr-row');
        await expect(rows).toHaveCount(4);
        // The card auto-opens when there is anything to action, and the chip counts it.
        await expect(page.locator('#resetRequestsCountChip')).toHaveText('4');
        await expect(page.locator('.rr-row').first()).toBeVisible();
        // An unprovisioned account needs Set up accounts, not Reset — different remedy, stated. So does
        // a DISABLED one (a reset is refused for it), and it is named as disabled, not as missing.
        await expect(rows.filter({ hasText: 'N. Bedingfield' }).locator('.rr-remedy--setup'))
            .toHaveText('No account yet — run Set up accounts');
        await expect(rows.filter({ hasText: 'O. Mylla' }).locator('.rr-remedy--setup'))
            .toHaveText('Account disabled — run Set up accounts');
        await expect(rows.filter({ hasText: 'K. Jedlinski' }).locator('.rr-remedy')).toHaveText('Reset below in Account status');
        await expect(page.locator('.rr-row', { hasText: 'K. Jedlinski' })).toContainText('asked 4 times');

        // No row may overflow its own box — the failure mode that shipped. Checked per flex child,
        // because the PAGE reports no overflow when a flex item overflows internally.
        const overflow = await page.locator('.rr-main').evaluateAll(
            els => els.map(el => el.scrollWidth - el.clientWidth));
        expect(overflow, `.rr-main overflow at ${width}px`).toEqual([0, 0, 0, 0]);
        const pageOverflow = await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(pageOverflow).toBeLessThanOrEqual(1);
    });
}

// A server stamp is AHEAD of a device whose clock runs slow, and the shared formatter printed the gap
// as a negative age — "-90s ago" (Nov 2026 review). The Error Log's rows use the same formatter.
test('operations reset requests: a request stamped ahead of this device\'s clock reads "just now"', async ({ page }) => {
    await page.addInitScript(() => {
        /** @type {any} */ (window).__E2E = { docs: [{ id: 'A. Hared', requestedAt: Date.now() + 90_000, count: 1, provisioned: true }] };
    });
    await seedSession(page, 'G. Miller');
    await page.goto('/operations.html');
    const when = page.locator('.rr-row .rr-when');
    await expect(when).toContainText('just now');
    await expect(when).not.toContainText('-');
});

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

// v26.04 — the admin's Error Log notification (functions/error-log-notify.js) opens operations.html#error-log.
// Tapped while Operations is ALREADY open it only changes the hash, so the card opened over the entries read
// at page load: "2 new" beside a log without them. The card re-reads on the tap itself (operations-errors.js),
// from the hash the event CARRIED — the page's deep link strips location.hash in the same event.
test('operations: an Error Log tap on an OPEN page re-reads the log, and a second tap still lands', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.addInitScript(() => { /** @type {any} */ (window).__E2E = { authUser: true, docs: [] }; });
    await seedSession(page, 'G. Miller');
    await page.goto('/operations.html');
    await expect(page.locator('#errorLogContent')).toContainText('No errors recorded');

    const logged = (/** @type {string} */ id, /** @type {string} */ message) =>
        ({ id, memberName: 'A. Hared', page: 'admin', message, appVersion: '26.04', resolved: false, timestamp: Date.now() });
    await page.evaluate((row) => {
        /** @type {any} */ (window).__E2E.docs = [row];
        location.hash = '#error-log';
    }, logged('n1', 'boom after the tap'));
    await expect(page.locator('#errorLogBody')).toHaveClass(/\bopen\b/);
    await expect(page.locator('#errorLogContent')).toContainText('boom after the tap');
    // Followed, then stripped — so the next tap is a CHANGE of hash, not a repeat of one.
    await expect.poll(() => page.evaluate(() => location.hash)).toBe('');

    await page.evaluate((row) => {
        /** @type {any} */ (window).__E2E.docs.push(row);
        location.hash = '#error-log';
    }, logged('n2', 'bang on the second tap'));
    await expect(page.locator('#errorLogContent')).toContainText('bang on the second tap');
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

// ── AN ADDRESS NAMED LIKE A BUILT-IN (routed from pwa, Nov 2026) ─────────────────────────────────
// Addresses are keys any signed-in session can write. A lookup that walks the prototype took
// "constructor" for a known address — the Object function — and printed "undefined" for its label, in
// the bars, the installed-app line and the key. The card asks its table for its OWN entries only.
// (summariseOrigins now files an unknown label under 'other' before it gets here; the card does not
// depend on that.)
test('operations usage: an address named like a built-in is "elsewhere", never "undefined"', async ({ page }) => {
    const card = await openUsageCard(page, { usage: usageStats({ origins: [
        { origin: 'web', accounts: 20, installed: 15 }, { origin: 'constructor', accounts: 3, installed: 1 }] }) });
    const origins = card.locator('.usage-origins');
    await expect(origins).toContainText('elsewhere');
    await expect(origins).not.toContainText('undefined');
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

// The month toggle clips to its pill (`overflow: hidden`) and its two buttons fill it edge to edge, so
// the shared focus ring — drawn 2px OUTSIDE a button — was cut away but for a hairline at the seam: a
// keyboard user on "Last month" saw almost nothing. Geometry, because a focus state is in no
// screenshot baseline: wherever the ring is drawn, it must lie inside the box that clips it.
test('operations usage: the month toggle draws its focus ring inside the pill that clips it', async ({ page }) => {
    const card = await openUsageCard(page);
    for (const label of ['This month', 'Last month']) {
        const btn = card.locator('.speed-toggle-btn', { hasText: label });
        await page.keyboard.press('Tab');   // keyboard modality, so the programmatic focus below is :focus-visible
        await btn.focus();
        const g = await btn.evaluate(el => {
            const cs = getComputedStyle(el);
            const toggle = /** @type {HTMLElement} */ (el.parentElement);
            const ts = getComputedStyle(toggle);
            const b = el.getBoundingClientRect(), t = toggle.getBoundingClientRect();
            const reach = Math.max(0, parseFloat(cs.outlineOffset) + parseFloat(cs.outlineWidth));   // past the button's box
            const bw = parseFloat(ts.borderLeftWidth);
            return {
                ring: el.matches(':focus-visible') && cs.outlineStyle !== 'none', clips: ts.overflow,
                inside: b.left - reach >= t.left + bw - 0.5 && b.right + reach <= t.right - bw + 0.5
                    && b.top - reach >= t.top + bw - 0.5 && b.bottom + reach <= t.bottom - bw + 0.5,
            };
        });
        expect(g.ring, `${label}: a keyboard focus draws a ring`).toBe(true);
        expect(g.clips, 'premise: the toggle clips to its pill').toBe('hidden');
        expect(g.inside, `${label}: the focus ring is drawn where the pill cuts it away`).toBe(true);
    }
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

// The Enter that accepts an input method's suggestion is left to it (sign-in audit E4, 13 Nov 2026): the inline form
// saved half-typed text on it. Sent as the browser sends it — `isComposing` — and a plain Enter afterwards still saves.
test('operations account status: the Enter that accepts an input method\'s suggestion does not save the email', async ({ page }) => {
    await page.addInitScript(() => {
        /** @type {any} */ (window).__E2E = { authUser: true, docs: [], docsByPath: { staffContact: [], passwordStatus: [], resetRequests: [] } };
    });
    await page.route(/getAccountSetupGaps|getSignInStats/, route => route.abort('failed'));   // hermetic
    await seedSession(page, 'G. Miller');
    await page.goto('/operations.html');
    await page.evaluate(() => document.getElementById('accountStatusBody')?.classList.add('open'));
    const row = page.locator('.acct-row').first();
    await row.locator('.email-set-btn').first().click();
    const input = row.locator('.email-set-form input');
    await input.fill('test.per');
    const took = await input.evaluate(el =>
        !el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true })));
    expect(took, 'the form took a composition\'s Enter').toBe(false);
    await expect(row.locator('.email-set-save')).toHaveText('Save');
    await expect(row.locator('.email-set-form')).toHaveCount(1);
    await input.press('Enter');                                         // a plain Enter still saves
    await expect(row.locator('.email-set-form'), 'the save landed and the list was redrawn').toHaveCount(0);
});

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

// ── EVERY OPERATIONS WRITE EXPLAINS A WAIT (Nov 2026 review) ────────────────────────────────────
// Admin (v24.21) and Settings (v24.38) say when a write is waiting on the server; Operations' saves sat
// on a bare "Saving…" or a silently disabled button. And Remove's three-second "Confirm?" timer, armed
// by the first tap, went on running through the delete and turned "Removing…" back into "Remove".
const ACCT_EMAIL_ROWS = { staffContact: [{ id: 'A. Hared', memberName: 'A. Hared', workEmail: 'a.hared@chilternrailways.co.uk' }], passwordStatus: [], resetRequests: [] };

test('operations account status: a Remove waiting on the server says so, and keeps saying "Removing…"', async ({ page }) => {
    await page.clock.install();
    await page.addInitScript((byPath) => {
        /** @type {any} */ (window).__E2E = { slowSaveMs: 300, failDeleteCode: 'unavailable', deleteDelayMs: 5000, docs: [], docsByPath: byPath };
    }, ACCT_EMAIL_ROWS);
    await seedSession(page, 'G. Miller');
    await page.goto('/operations.html');
    await page.clock.runFor(2000);
    await page.evaluate(() => document.getElementById('accountStatusBody')?.classList.add('open'));
    const remove = page.locator('.email-set-btn--remove').first();
    await remove.click();                       // arms "Confirm?" — and its three-second revert
    await remove.click();                       // removes; the harness holds the delete for five seconds
    await expect(remove).toHaveText('Removing…');
    await page.clock.runFor(3500);              // past the revert
    await expect(remove, 'the arming timer fired into the delete').toHaveText('Removing…');
    await expect(page.locator('#slowSaveNotice')).toBeVisible();
    await page.clock.runFor(2000);              // the delete is refused
    await expect(page.locator('.acct-row .email-set-error').first()).toHaveText(/Couldn’t remove/);
    await expect(page.locator('#slowSaveNotice')).toBeHidden();
});

test('operations account status: an email Save waiting on the server says so', async ({ page }) => {
    // The harness's setDoc lands at once, so the save is held by patching the served firebase-client.js
    // (the shape stubUsageReads uses) — loud if the anchor moves.
    await page.route('**/firebase-client.js', async route => {
        const res = await route.fetch();
        const src = await res.text();
        const anchor = 'export async function saveStaffContact(memberName, workEmail) {';
        if (!src.includes(anchor)) throw new Error(`save-hold anchor no longer matches — "${anchor}" in firebase-client.js`);
        await route.fulfill({ response: res, contentType: 'text/javascript',
            body: src.replace(anchor, anchor + ' await new Promise(r => { globalThis.__E2E.landSave = r; });') });
    });
    await page.addInitScript((byPath) => { /** @type {any} */ (window).__E2E = { slowSaveMs: 200, docs: [], docsByPath: byPath }; }, ACCT_EMAIL_ROWS);
    await seedSession(page, 'G. Miller');
    await page.goto('/operations.html');
    await page.evaluate(() => document.getElementById('accountStatusBody')?.classList.add('open'));
    const row = page.locator('.acct-row').filter({ hasNot: page.locator('.email-set-btn--remove') }).first();
    await row.locator('.email-set-btn').click();
    await row.locator('.email-set-form input').fill('test.person@chilternrailways.co.uk');
    await row.locator('.email-set-save').click();
    await expect(page.locator('#slowSaveNotice')).toBeVisible();
    await page.evaluate(() => /** @type {any} */ (window).__E2E.landSave());
    await expect(page.locator('#slowSaveNotice')).toBeHidden();
});

test('operations reset requests: a Clear waiting on the server says so', async ({ page }) => {
    await page.addInitScript(() => {
        /** @type {any} */ (window).__E2E = { slowSaveMs: 200, failDeleteCode: 'unavailable', deleteDelayMs: 1500,
            docs: [{ id: 'A. Hared', requestedAt: Date.now() - 60_000, count: 1, provisioned: true }] };
    });
    await seedSession(page, 'G. Miller');
    await page.goto('/operations.html');
    await page.locator('.btn-rr-clear[data-member="A. Hared"]').click();
    await expect(page.locator('#slowSaveNotice')).toBeVisible();
    await expect(page.locator('.rr-row .rr-error')).toHaveText(/Couldn.t clear/);
    await expect(page.locator('#slowSaveNotice')).toBeHidden();
});

// ── A ROW BUTTON'S NAME LEADS WITH ITS WORDS, IN EVERY STATE (WCAG 2.5.3, Nov 2026 review) ──────
// The Account status buttons had FIXED names. "Set email" was named "Set work email for …", so somebody
// driving by voice said what they saw and reached nothing; and "Cancel", "Confirm?", "Removing…",
// "Resetting…" and "Retry" kept the name of the state before, so a screen reader was not told the
// button had changed. axe's own containment rule, on this card only, in each state a row can be in.
/** @param {import('@playwright/test').Page} page */
const nameMismatches = async (page) => (await new AxeBuilder({ page }).include('#accountStatusCard')
    .withRules(['label-content-name-mismatch']).analyze()).violations.flatMap(v => v.nodes.map(n => n.target.join(' ')));

test('operations account status: every row button\'s name holds its visible words, in every state', async ({ page }) => {
    await page.addInitScript((byPath) => {
        /** @type {any} */ (window).__E2E = { authUser: true, docs: [], failDeleteCode: 'unavailable', deleteDelayMs: 60_000, docsByPath: byPath };
    }, ACCT_EMAIL_ROWS);
    // Hermetic: with a stub user signed in, the audit and the sign-in counts would otherwise fetch.
    await page.route(/getAccountSetupGaps|getSignInStats/, route => route.abort('failed'));
    const plans = ['hold', 500, 200];   // the first reset never answers, the second fails, the third lands
    await page.route('**/resetMemberPassword', route => {
        const plan = plans.shift();
        if (plan === 'hold') return;
        return route.fulfill({ status: Number(plan), contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
            body: JSON.stringify(plan === 200 ? { revoked: true, stamped: true, notified: true } : { error: 'Reset failed' }) });
    });
    await seedSession(page, 'G. Miller');
    await page.goto('/operations.html');
    await page.evaluate(() => document.getElementById('accountStatusBody')?.classList.add('open'));
    await expect(page.locator('.acct-row').first()).toBeVisible();
    expect(await nameMismatches(page), 'resting: Set email · Edit · Remove · Reset').toEqual([]);

    const plain = page.locator('.acct-row').filter({ hasNot: page.locator('.email-set-btn--remove') }).first();
    await plain.locator('.email-set-btn').click();
    await expect(plain.locator('.email-set-btn')).toHaveText('Cancel');
    expect(await nameMismatches(page), 'the form open: Cancel').toEqual([]);

    const remove = page.locator('.email-set-btn--remove').first();
    await remove.click();
    await expect(remove).toHaveText('Confirm?');
    expect(await nameMismatches(page), 'Remove armed: Confirm?').toEqual([]);
    await remove.click();
    await expect(remove).toHaveText('Removing…');
    expect(await nameMismatches(page), 'Remove under way: Removing…').toEqual([]);

    const resetOn = async (/** @type {number} */ i) => {
        await page.locator('.acct-row').nth(i).locator('.btn-acct-reset').click();
        await page.locator('.lb-overlay.open .dialog-btn-confirm').click();   // an earlier, closed dialog is still in the DOM
    };
    await resetOn(0);
    await expect(page.locator('.acct-row').nth(0).locator('.btn-acct-reset')).toHaveText('Resetting…');
    expect(await nameMismatches(page), 'a reset under way: Resetting…').toEqual([]);
    await resetOn(1);
    await expect(page.locator('.acct-row').nth(1).locator('.btn-acct-reset')).toHaveText('Retry');
    expect(await nameMismatches(page), 'a reset that failed: Retry').toEqual([]);
    await page.locator('.lb-overlay.open .dialog-btn-confirm').click();   // the 500's own sentence, shown since the sign-in audit (Nov 2026)
    await resetOn(2);
    await expect(page.locator('.acct-row').nth(2).locator('.btn-acct-reset')).toHaveText('Reset ✓');
    await expect(page.locator('.acct-row').nth(2).locator('.btn-acct-reset')).toHaveAttribute('aria-label', /done/);
    expect(await nameMismatches(page), 'a reset that landed: Reset ✓').toEqual([]);
});

// ── KEYBOARD FOCUS IS NEVER DROPPED ON THE PAGE (Nov 2026 review) ───────────────────────────────
// Escape in the inline email form removed the field that had focus and returned it nowhere, and a reset
// that landed re-drew the list under the button that had made it — the save and remove paths already
// put focus somewhere visible; these two did not.
test('operations account status: Escape out of the email form returns focus to its button', async ({ page }) => {
    await page.addInitScript((byPath) => { /** @type {any} */ (window).__E2E = { docs: [], docsByPath: byPath }; }, ACCT_EMAIL_ROWS);
    await seedSession(page, 'G. Miller');
    await page.goto('/operations.html');
    await page.evaluate(() => document.getElementById('accountStatusBody')?.classList.add('open'));
    const row = page.locator('.acct-row').filter({ hasNot: page.locator('.email-set-btn--remove') }).first();
    const btn = row.locator('.email-set-btn');
    await btn.focus();
    await page.keyboard.press('Enter');
    await expect(row.locator('.email-set-form input')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(row.locator('.email-set-form')).toHaveCount(0);
    await expect(btn).toHaveText('Set email');
    await expect(btn, 'focus fell to the page').toBeFocused();
});

test('operations account status: a reset that lands keeps focus on that row\'s Reset', async ({ page }) => {
    await page.addInitScript(() => {
        /** @type {any} */ (window).__E2E = { authUser: true, docs: [], docsByPath: { staffContact: [], passwordStatus: [], resetRequests: [] } };
    });
    await page.route(/getAccountSetupGaps|getSignInStats/, route => route.abort('failed'));   // hermetic
    await page.route('**/resetMemberPassword', route => route.fulfill({
        status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({ revoked: true, stamped: true, notified: true }),
    }));
    await seedSession(page, 'G. Miller');
    await page.goto('/operations.html');
    await page.evaluate(() => document.getElementById('accountStatusBody')?.classList.add('open'));
    const row = page.locator('.acct-row').nth(1);
    const name = await row.getAttribute('data-member');
    await row.locator('.btn-acct-reset').focus();
    await page.keyboard.press('Enter');
    await page.locator('.lb-overlay.open .dialog-btn-confirm').click();
    const again = page.locator(`.acct-row[data-member="${name}"] .btn-acct-reset`);
    await expect(again).toHaveText('Reset ✓');
    await expect(again, 'the re-drawn list took focus with it').toBeFocused();
});

// WCAG 2.5.3 again: each file input's name must hold the words of the label that stands for it on
// screen ("Choose file", "Choose PDF", "Choose leave file"). They were "Choose huddle PDF or Word
// document" and the like, so "click Choose file" reached nothing. axe does not test inputs for this,
// so it is measured here.
test('operations: every file input\'s name begins with the words of its visible label', async ({ page }) => {
    await seedSession(page, 'G. Miller');
    await page.goto('/operations.html');
    const pairs = await page.locator('label.huddle-file-label').evaluateAll(labels => labels.map(l => [
        (l.textContent || '').trim(), document.getElementById(l.getAttribute('for') || '')?.getAttribute('aria-label') || '']));
    expect(pairs.length, 'premise: five file inputs — the three documents, the roster PDF and the leave file').toBe(5);
    for (const [label, name] of pairs) expect(name.startsWith(label), `"${name}" does not begin with "${label}"`).toBe(true);
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

/**
 * Serve the Error Log its rows from the page, and optionally hold or refuse each Resolve — by patching
 * analytics-client.js as it is served, the shape `stubUsageReads` (helpers.js) uses. The harness's
 * getDocs cannot do either: it answers BOTH of getClientErrors' queries with the same rows and ignores
 * the cap, so it can neither keep resolved and unresolved apart nor say "truncated", and every write
 * it makes lands at once. LOUD on a missing anchor, so a renamed function fails here, not silently.
 * `window.__E2E.errorRows` replaces the rows for every later read; `resolveGate(id)` runs before each
 * Resolve's write, so a test can hold one open or make it fail. No stub Firebase user: neither card
 * needs one, and without it the account audit and the sign-in counts stop before they fetch anything.
 * @param {import('@playwright/test').Page} page
 * @param {Array<{id: string, message: string, resolved?: boolean}>} rows
 * @param {{ truncated?: boolean }} [o]
 */
async function stubErrorLog(page, rows, { truncated = false, resolvedTruncated = undefined } = {}) {
    await page.addInitScript(({ rows, truncated, resolvedTruncated }) => {
        const w = /** @type {any} */ (window);
        const ts = (/** @type {number} */ ms) => ({ toDate: () => new Date(ms), toMillis: () => ms });
        w.__E2E = { ...(w.__E2E || {}), errorRows: rows,
            // `resolvedTruncated` is left out unless a test sets it: an older reader does not send it.
            errorLog: () => ({ truncated, ...(resolvedTruncated === undefined ? {} : { resolvedTruncated }),
                errors: w.__E2E.errorRows.map((/** @type {any} */ r, /** @type {number} */ i) => ({
                    memberName: 'A. Hared', page: 'calendar', appVersion: '25.64', resolved: false, ...r,
                    timestamp: ts(Date.now() - (i + 1) * 60_000) })) }) };
    }, { rows, truncated, resolvedTruncated });
    await page.route('**/analytics-client.js', async route => {
        const res = await route.fetch();
        let src = await res.text();
        for (const [anchor, inject] of [
            ['    async function getClientErrors() {', ' return globalThis.__E2E.errorLog();'],
            ['    async function resolveClientError(id) {', ' if (globalThis.__E2E.resolveGate) await globalThis.__E2E.resolveGate(id);'],
        ]) {
            if (!src.includes(anchor)) throw new Error(`error-log fixture anchor no longer matches — "${anchor}" in analytics-client.js`);
            src = src.replace(anchor, anchor + inject);
        }
        await route.fulfill({ response: res, body: src, contentType: 'text/javascript' });
    });
}

// ── A CAPPED ERROR LOG COUNTS WHAT IT SAW, AS A FLOOR (Nov 2026 review) ─────────────────────────
// Slow-save diagnostics are listed and never counted, but they take places in the 100-row cap like
// anything else. The chip and the strip both read "100+" over two real errors, and over a cap holding
// none the chip was EMPTY while the strip still said "100+" — two voices, two answers. Both are now
// spelled by attentionBadge from one pair: how many errors were seen, and "+" for entries not loaded.
const DIAG = (/** @type {string} */ id) => ({ id, message: 'Slow save (diagnostic) — 9s, token 40ms' });
for (const [label, rows, badge] of [
    ['two errors among the diagnostics read "2+", not "100+"', [DIAG('d1'), { id: 'e1', message: 'boom one' }, DIAG('d2'), { id: 'e2', message: 'boom two' }, DIAG('d3')], '2+'],
    ['a cap of diagnostics alone reads "0+" in both voices, not an empty chip under "100+"', [DIAG('d1'), DIAG('d2'), DIAG('d3')], '0+'],
]) {
    test(`operations attention: ${label}`, async ({ page }) => {
        await stubErrorLog(page, /** @type {any} */ (rows), { truncated: true });
        await seedSession(page, 'G. Miller');
        await page.goto('/operations.html#error-log');
        await expect(page.locator('#errorLogContent .error-truncation-note')).toContainText('3 of them slow-save diagnostics');
        await expect(page.locator('#errorLogCountChip')).toHaveText(badge);
        await expect(page.locator('#attentionStrip .attn-item')).toHaveText(new RegExp(`Unresolved errors\\s*${badge.replace('+', '\\+')}`));
    });
}

// ── A CUT RESOLVED LIST SAYS SO (routed from pwa, Nov 2026) ─────────────────────────────────────
// Past 200 resolved records the read takes an unordered 200, so the card lists the newest of THAT 200,
// not necessarily the newest. The reader says when (`resolvedTruncated`, pwa-5); the card says so
// once, where the resolved rows begin (at the end when none is listed) — and nothing at all when the
// flag is false or absent.
const OPEN_ROW = { id: 'e1', message: 'boom one' };
const RESOLVED_ROWS = [OPEN_ROW, { id: 'r1', message: 'old one', resolved: true }, { id: 'r2', message: 'old two', resolved: true }];
for (const [label, rows, flag, order] of /** @type {const} */ ([
    ['says so where the resolved rows begin', RESOLVED_ROWS, true, ['open', 'note', 'resolved', 'resolved']],
    ['says so at the end when no resolved row is listed', [OPEN_ROW], true, ['open', 'note']],
    ['says nothing when the list was not cut', RESOLVED_ROWS, false, ['open', 'resolved', 'resolved']],
    ['says nothing to a reader that sends no flag', RESOLVED_ROWS, undefined, ['open', 'resolved', 'resolved']]])) {
    test(`operations errors: a cut resolved list ${label}`, async ({ page }) => {
        await stubErrorLog(page, /** @type {any} */ (rows), { resolvedTruncated: flag });
        await seedSession(page, 'G. Miller');
        await page.goto('/operations.html#error-log');
        await expect(page.locator('#errorLogContent .error-row')).toHaveCount(rows.length);
        const seen = await page.locator('#errorLogContent > *').evaluateAll(els => els.map(e =>
            e.classList.contains('error-resolved-cap-note') ? 'note'
                : e.classList.contains('error-row--resolved') ? 'resolved' : e.classList.contains('error-row') ? 'open' : null).filter(Boolean));
        expect(seen).toEqual(order);
        if (order.includes('note')) await expect(page.locator('#errorLogContent .error-resolved-cap-note'))
            .toHaveText('More than 200 resolved errors — the resolved entries shown may not be the most recent.');
    });
}

/** Hold every Resolve before its write; `window.__E2E.calls` lists them, oldest first, each with
 *  `res()` / `rej(err)` to land it. @param {import('@playwright/test').Page} page */
const holdResolves = (page) => page.addInitScript(() => {
    const w = /** @type {any} */ (window);
    w.__E2E.calls = [];
    w.__E2E.resolveGate = (/** @type {string} */ id) => new Promise((res, rej) => w.__E2E.calls.push({ id, res, rej }));
});
const ERR_ROWS = [{ id: 'e0', message: 'boom zero' }, { id: 'e1', message: 'boom one' }, { id: 'e2', message: 'boom two' }];

// ── AN ERROR LOG RESOLVE OF UNKNOWN OUTCOME IS NOT A FAILURE (Nov 2026 review) ──────────────────
// AUTH_AND_SESSIONS 22. A Resolve abandoned at a sign-out may still land, and the page's write gate
// refuses every later write until reload — so "✗ Failed — try again" sent the admin into a refusal
// that said the same thing every time. Both write paths now say which kind it was, and stay off.
test('operations error log: a Resolve signed out mid-write is unconfirmed, not failed, and stays off', async ({ page }) => {
    await stubErrorLog(page, ERR_ROWS);
    await page.addInitScript(() => { /** @type {any} */ (window).__E2E.failSetCode = 'auth/signed-out-during-request'; });
    await seedSession(page, 'G. Miller');
    await page.goto('/operations.html#error-log');
    const first = page.locator('.error-row').first();
    await first.locator('.error-resolve-btn').click();
    await expect(first).toContainText('signed out before this resolve was confirmed');
    await expect(first.locator('.error-resolve-btn')).toBeDisabled();
    // The gate refuses the next write before it is sent — and the row says that, not "Failed".
    await page.evaluate(() => { /** @type {any} */ (window).__E2E.failSetCode = null; });
    const second = page.locator('.error-row').nth(1);
    await second.locator('.error-resolve-btn').click();
    await expect(second).toContainText('An earlier change on this page was not confirmed');
    await expect(second.locator('.error-resolve-btn')).toBeDisabled();
});

test('operations error log: "Resolve all shown" signed out mid-write is unconfirmed, and stays off', async ({ page }) => {
    await stubErrorLog(page, ERR_ROWS);
    await page.addInitScript(() => { /** @type {any} */ (window).__E2E.failSetCode = 'auth/signed-out-during-request'; });
    await seedSession(page, 'G. Miller');
    await page.goto('/operations.html#error-log');
    const all = page.locator('.error-resolve-all-btn');
    await all.click();
    await expect(page.locator('.error-log-toolbar')).toContainText('signed out before this batch of resolves was confirmed');
    await expect(all).toBeDisabled();
    await expect(all).not.toContainText('try again');
});

// ── "RESOLVE ALL SHOWN" NAMES THE ROWS THAT FAILED (Nov 2026 review) ────────────────────────────
// It matched its results BY INDEX against the shown list, which a row's own Resolve finishing in the
// meantime replaces with a shorter one — so the card blamed a neighbour, and "try again" re-stamped a
// row that had resolved while dropping the one that had not.
test('operations error log: "Resolve all shown" retries the row that failed, not its neighbour', async ({ page }) => {
    await stubErrorLog(page, ERR_ROWS);
    await holdResolves(page);
    await seedSession(page, 'G. Miller');
    await page.goto('/operations.html#error-log');
    await page.locator('.error-row').first().locator('.error-resolve-btn').click();   // e0's own Resolve — held
    await page.locator('.error-resolve-all-btn').click();                              // e0, e1, e2 — held
    await expect.poll(() => page.evaluate(() => /** @type {any} */ (window).__E2E.calls.map((/** @type {any} */ c) => c.id))).toEqual(['e0', 'e0', 'e1', 'e2']);
    await page.evaluate(() => /** @type {any} */ (window).__E2E.calls[0].res());    // the row's own write lands first…
    await expect(page.locator('.error-row').first()).toHaveClass(/error-row--resolved/);   // …and prunes the list
    await page.evaluate(() => {
        const [, b0, b1, b2] = /** @type {any} */ (window).__E2E.calls;
        b0.res(); b1.rej(new Error('e2e: refused')); b2.res();                       // e1 genuinely fails
    });
    const all = page.locator('.error-resolve-all-btn');
    await expect(all).toHaveText("✗ 1 didn't resolve — try again");
    await all.click();
    await expect.poll(() => page.evaluate(() => /** @type {any} */ (window).__E2E.calls.slice(4).map((/** @type {any} */ c) => c.id)),
        { message: 'the retry must be for the row that failed' }).toEqual(['e1']);
});

test('operations error log: a batch failure that the row\'s own Resolve made good is not reported', async ({ page }) => {
    await stubErrorLog(page, ERR_ROWS);
    await holdResolves(page);
    await seedSession(page, 'G. Miller');
    await page.goto('/operations.html#error-log');
    await page.locator('.error-row').first().locator('.error-resolve-btn').click();
    await page.locator('.error-resolve-all-btn').click();
    await expect.poll(() => page.evaluate(() => /** @type {any} */ (window).__E2E.calls.length)).toBe(4);
    await page.evaluate(() => /** @type {any} */ (window).__E2E.calls[0].res());
    await expect(page.locator('.error-row').first()).toHaveClass(/error-row--resolved/);
    await page.evaluate(() => {
        const w = /** @type {any} */ (window);
        const [, b0, b1, b2] = w.__E2E.calls;
        w.__E2E.errorRows = [];                                    // what the refresh will read back
        b0.rej(new Error('e2e: refused')); b1.res(); b2.res();      // e0's batch write fails — but e0 IS resolved
    });
    await expect(page.locator('#errorLogContent')).toContainText('No errors recorded');
});

// ── "RESOLVE ALL SHOWN" SAYS WHAT IT RESOLVED (whole-app check, 17 Nov 2026) ─────────────────────
// The chip and the strip leave slow-save diagnostics out of the error count, and the screen-reader line
// after a Resolve all counted every entry as an error: "3 errors resolved" for two errors and a diagnostic.
for (const [label, rows, said] of /** @type {const} */ ([
    ['errors and a diagnostic', [{ id: 'e1', message: 'boom one' }, DIAG('d1'), { id: 'e2', message: 'boom two' }], '2 errors and 1 slow-save diagnostic resolved'],
    ['diagnostics alone', [DIAG('d1'), DIAG('d2')], '2 slow-save diagnostics resolved'],
    ['one error', [{ id: 'e1', message: 'boom one' }], '1 error resolved'],
])) {
    test(`operations error log: "Resolve all shown" over ${label} says what it resolved`, async ({ page }) => {
        await stubErrorLog(page, [...rows]);
        await seedSession(page, 'G. Miller');
        await page.goto('/operations.html#error-log');
        await expect(page.locator('.error-row')).toHaveCount(rows.length);
        await page.evaluate(() => { /** @type {any} */ (window).__E2E.errorRows = []; });   // what the refresh reads back
        await page.locator('.error-resolve-all-btn').click();
        await expect(page.locator('#errorLogContent')).toContainText('No errors recorded');
        await expect(page.locator('#errorLogContent [role="status"]').first()).toHaveText(said);
    });
}

// ── COPY DETAILS CARRIES NO NAME (whole-app check, 17 Nov 2026) ─────────────────────────────────
// The block is for pasting into a chat outside the app. The row shows whose error it was; the copy has
// the message, page, version, device and time, which are the diagnosis, and not the colleague's name.
test('operations error log: Copy details leaves out the member the error happened to', async ({ page }) => {
    await stubErrorLog(page, [{ id: 'e1', message: 'boom one' }]);
    await page.addInitScript(() => {
        const w = /** @type {any} */ (window);
        w.__copied = [];
        Object.defineProperty(navigator, 'clipboard', { configurable: true,
            value: { writeText: (/** @type {string} */ t) => { w.__copied.push(t); return Promise.resolve(); } } });
    });
    await seedSession(page, 'G. Miller');
    await page.goto('/operations.html#error-log');
    const row = page.locator('.error-row').first();
    await expect(row.locator('.error-member'), 'premise: the row names the member').toHaveText('A. Hared');
    await row.locator('.error-copy-btn').click();
    await expect(row.locator('.error-copy-btn')).toHaveText('✓ Copied');
    const copied = await page.evaluate(() => /** @type {any} */ (window).__copied.join('\n'));
    expect(copied).toContain('Error: boom one');
    expect(copied).toContain('Page:        calendar');
    expect(copied).toContain('App version: 25.64');
    expect(copied).not.toContain('A. Hared');
    expect(copied).not.toMatch(/Member/);
});

// ── A RESOLVE WAITING ON THE SERVER SAYS SO (Nov 2026 review) ───────────────────────────────────
// Admin (v24.21) and Settings (v24.38) explain a write the server has not answered; Operations' writes
// sat on a silently disabled button. Every one now goes through withSlowSaveNotice.
test('operations error log: a Resolve, and Resolve all shown, waiting on the server say so', async ({ page }) => {
    await stubErrorLog(page, ERR_ROWS.slice(0, 2));
    await holdResolves(page);
    await page.addInitScript(() => { /** @type {any} */ (window).__E2E.slowSaveMs = 200; });
    await seedSession(page, 'G. Miller');
    await page.goto('/operations.html#error-log');
    const notice = page.locator('#slowSaveNotice');
    await page.locator('.error-row').first().locator('.error-resolve-btn').click();
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('Still sending');
    await page.evaluate(() => /** @type {any} */ (window).__E2E.calls[0].res());
    await expect(notice).toBeHidden();
    await page.locator('.error-resolve-all-btn').click();
    await expect(notice).toBeVisible();
    await page.evaluate(() => /** @type {any} */ (window).__E2E.calls[1].res());
    await expect(notice).toBeHidden();
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

// A refusal whose body is not the endpoint's own sentence — an HTML error page from in front of the
// function — was shown VERBATIM as the reason (Nov 2026 review). The endpoint's own 4xx all come before
// anything is changed, so a refusal can say plainly that nothing was reset.
test('operations: a refusal that is an HTML page is not shown as the reason', async ({ page }) => {
    await page.addInitScript(() => {
        /** @type {any} */ (window).__E2E = { authUser: true, docs: [], docsByPath: { staffContact: [], passwordStatus: [], resetRequests: [] } };
    });
    await page.route(/getAccountSetupGaps|getSignInStats/, route => route.abort('failed'));   // hermetic
    await page.route('**/resetMemberPassword', route => route.fulfill({
        status: 404, contentType: 'text/html', headers: { 'access-control-allow-origin': '*' },
        body: '<!DOCTYPE html><html lang=en><title>Error 404 (Not Found)!!1</title><p><b>404.</b> That’s an error.',
    }));
    await seedSession(page, 'G. Miller');
    await page.goto('/operations.html');
    await page.evaluate(() => document.getElementById('accountStatusBody')?.classList.add('open'));
    await page.locator('.acct-row').first().locator('.btn-acct-reset').click();
    await page.locator('.dialog-btn-confirm').click();
    const dialog = page.locator('.lb-overlay.open');
    await expect(dialog).toContainText('The reset was refused');
    await expect(dialog).toContainText('Nothing was reset');
    await expect(dialog).not.toContainText('<');
});

// A RESET THE SERVER COULD NOT RECORD CHANGED NOTHING, AND SAYS SO (whole-app fix, Nov 2026). A device
// the reset signs out is kept out only by the SAVED resetAt (AUTH_AND_SESSIONS 23), so the server now
// stamps it FIRST and answers 503 when it cannot — before the password changes (functions-core-2). The
// page used to show only "Retry"; the sentence that says nothing was changed is shown beside it.
test('operations: a reset the server could not record says nothing changed, and offers Retry', async ({ page }) => {
    await page.addInitScript(() => {
        /** @type {any} */ (window).__E2E = { authUser: true, docs: [], docsByPath: { staffContact: [], passwordStatus: [], resetRequests: [] } };
    });
    await page.route(/getAccountSetupGaps|getSignInStats/, route => route.abort('failed'));   // hermetic
    await page.route('**/resetMemberPassword', route => route.fulfill({
        status: 503, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({ error: 'Could not record the reset, so nothing was changed — try again' }),
    }));
    await seedSession(page, 'G. Miller');
    await page.goto('/operations.html');
    await page.evaluate(() => document.getElementById('accountStatusBody')?.classList.add('open'));
    const row = page.locator('.acct-row').first();
    await row.locator('.btn-acct-reset').click();
    await page.locator('.dialog-btn-confirm').click();
    const dialog = page.locator('.lb-overlay.open');
    await expect(dialog).toContainText('The reset didn’t go through');
    await expect(dialog).toContainText('nothing was changed');
    await expect(row.locator('.btn-acct-reset')).toHaveText(/Retry/);
});

// AN ACCOUNT TAKEN BACK WAITS ON SET UP ACCOUNTS (v24.57). It holds no claim yet, so the dialog leads
// with the step the admin must take next.
test('operations: a reset that took an account back says to run Set up accounts', async ({ page }) => {
    await page.addInitScript(() => {
        /** @type {any} */ (window).__E2E = { authUser: true, docs: [], docsByPath: { staffContact: [], passwordStatus: [], resetRequests: [] } };
    });
    await page.route(/getAccountSetupGaps|getSignInStats/, route => route.abort('failed'));   // hermetic
    await page.route('**/resetMemberPassword', route => route.fulfill({
        status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({ revoked: true, stamped: true, notified: true, takenBack: true }),
    }));
    await seedSession(page, 'G. Miller');
    await page.goto('/operations.html');
    await page.evaluate(() => document.getElementById('accountStatusBody')?.classList.add('open'));
    await page.locator('.acct-row').first().locator('.btn-acct-reset').click();
    await page.locator('.dialog-btn-confirm').click();
    const dialog = page.locator('.lb-overlay.open');
    await expect(dialog).toContainText('Account taken back — run Set up accounts');
    await expect(dialog).toContainText('Run Set up accounts next');
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

// ── A LOST OR STOLEN PHONE, AND WHAT EVERY RESET SAYS (sign-in audit D1/A1 and E2, and the 500's sentence — 13 Nov 2026) ──
// A reset's "🔑 Password reset" notice landed on the lock screen of the very phone that was lost, and the phone kept
// getting the member's notices. The Reset dialog now asks, with an unticked box; ticked, the request asks for
// `lostDevice: true` and the server sends no notice and deletes every push record the member owns. The words are
// operations-reset.js's; these drive the real page — the body sent, and what each answer says.
/** Operations with the reset endpoint answering `answer` (as JSON) or `body` (as a page), recording each body sent.
 *  @param {import('@playwright/test').Page} page @param {{ status?: number, answer?: any, body?: string }} o */
async function openForReset(page, { status = 200, answer = {}, body } = {}) {
    /** @type {any[]} */ const sent = [];
    await page.addInitScript(() => {
        /** @type {any} */ (window).__E2E = { authUser: true, docs: [], docsByPath: { staffContact: [], passwordStatus: [], resetRequests: [] } };
    });
    await page.route(/getAccountSetupGaps|getSignInStats/, route => route.abort('failed'));   // hermetic
    await page.route('**/resetMemberPassword', route => {
        if (route.request().method() === 'POST') sent.push(route.request().postDataJSON());
        return route.fulfill({ status, contentType: body ? 'text/html' : 'application/json',
            headers: { 'access-control-allow-origin': '*' }, body: body ?? JSON.stringify(answer) });
    });
    await seedSession(page, 'G. Miller');
    await page.goto('/operations.html');
    await page.evaluate(() => document.getElementById('accountStatusBody')?.classList.add('open'));
    const row = page.locator('.acct-row').first();
    return { sent, row, name: String(await row.getAttribute('data-member')) };
}
/** Press the row's Reset, tick the lost-phone box if asked, and confirm. @param {import('@playwright/test').Page} page @param {any} row */
async function pressReset(page, row, { lost = false } = {}) {
    await row.locator('.btn-acct-reset').click();
    const dialog = page.locator('.lb-overlay.open');
    if (lost) await dialog.getByRole('checkbox', { name: LOST_PHONE.label }).check();
    await dialog.locator('.dialog-btn-confirm').click();
}
const LANDED = { ok: true, revoked: true, stamped: true, notified: true };

test('operations: Reset asks about a lost phone, unticked, and asks the server for it only when ticked', async ({ page }) => {
    const { sent, row, name } = await openForReset(page, { answer: LANDED });
    await row.locator('.btn-acct-reset').click();
    const box = page.locator('.lb-overlay.open').getByRole('checkbox', { name: LOST_PHONE.label });
    await expect(box).not.toBeChecked();
    await expect(box).toHaveAccessibleDescription(LOST_PHONE.hint);
    await page.locator('.lb-overlay.open .dialog-btn-confirm').click();
    await expect(row.locator('.btn-acct-reset')).toHaveText('Reset ✓');
    expect(sent, 'an unticked box sends exactly what a reset has always sent').toEqual([{ member: name }]);
    await pressReset(page, row, { lost: true });
    await expect.poll(() => sent.length).toBe(2);
    expect(sent[1]).toEqual({ member: name, lostDevice: true });
});

test('operations: the lost-phone box is the dialog\'s first stop — Space ticks it, Enter does not confirm, Tab reaches the buttons', async ({ page }) => {
    const { sent, row } = await openForReset(page, { answer: LANDED });
    await row.locator('.btn-acct-reset').focus();
    await page.keyboard.press('Enter');
    const dialog = page.locator('.lb-overlay.open');
    const box = dialog.getByRole('checkbox', { name: LOST_PHONE.label });
    await expect(box).toBeFocused();
    await page.keyboard.press('Space');
    await expect(box).toBeChecked();
    await page.keyboard.press('Enter');
    // The box itself, not "a dialog": a confirmed reset would put up its outcome, which is a dialog too.
    await expect(box, 'Enter on the box confirmed the reset').toBeVisible();
    await expect(box).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(dialog.locator('.dialog-btn-cancel')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(dialog.locator('.dialog-btn-confirm')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('.lb-overlay.open')).toHaveCount(0);
    await expect(row.locator('.btn-acct-reset'), 'a dismissed dialog reset nothing').toHaveText('Reset');
    expect(sent).toEqual([]);
});

for (const [label, answer, title, says, never] of /** @type {Array<[string, any, string, string[], RegExp]>} */ ([
    ['a lost-phone reset says what it did, and that nobody told them',
        { ...LANDED, notified: false, lostDevice: true, pushReleased: 2 }, 'Password reset — tell them yourself',
        ['WAS reset to their surname', 'signed out on every device, the lost phone included', 'notifications are now off on every device',
            'No reset notice was sent. Tell', 'their surname signs in to their account — on the lost phone too'],
        /No reset notice reached|COULDN’T/],
    ['a lost-phone reset whose notifications could not be switched off says so, and to reset again with the box ticked',
        { ...LANDED, notified: false, lostDevice: true, pushReleaseFailed: true }, 'Password reset — notifications still on',
        ['COULDN’T be switched off', 'Reset again with the box ticked', 'No reset notice was sent'], /notifications are now off/],
    ['a ticked box an older server ignored says the lost-phone step did not run',
        LANDED, 'Password reset — the lost-phone step didn’t run',
        ['WAS reset to their surname', 'The lost-phone step DIDN’T run', 'the usual reset notice went to their devices', 'Reset again with the box ticked'],
        /No reset notice was sent/],
])) {
    test(`operations: ${label}`, async ({ page }) => {
        const { row, name } = await openForReset(page, { answer });
        await pressReset(page, row, { lost: true });
        const dialog = page.locator('.lb-overlay.open');
        await expect(dialog.locator('.dialog-title')).toHaveText(title);
        for (const s of says) await expect(dialog).toContainText(s);
        if (title.endsWith('yourself')) await expect(dialog).toContainText(`Tell ${name} yourself`);
        await expect(dialog).not.toContainText(never);
        await expect(row.locator('.btn-acct-reset')).toHaveText('Reset ✓');
    });
}

// A SIGN-OUT THAT FAILED NO LONGER HIDES THAT NOBODY TOLD THEM (sign-in audit E2). "They have NOT been told" was shown
// only when the sign-out had worked, so the admin of a member with no notifications heard nothing about telling them;
// and the failed sign-out itself is not the open door it read as — the password change ends those sign-ins within the
// hour, so the line says so and offers the reset that ends them now.
test('operations: a reset whose sign-out failed still says nobody told them, and that those sign-ins end within the hour', async ({ page }) => {
    const { row, name } = await openForReset(page, { answer: { ok: true, revoked: false, revokeFailed: true, stamped: true, notified: false } });
    await pressReset(page, row);
    const dialog = page.locator('.lb-overlay.open');
    await expect(dialog.locator('.dialog-title')).toHaveText('Password reset — other devices not signed out yet');
    await expect(dialog).toContainText('when they next renew, within the hour — reset again to sign them out now');
    await expect(dialog).toContainText(`No reset notice reached ${name}'s devices, so they have NOT been told. Let them know their password is now their surname.`);
    await expect(dialog, 'they are not signed out yet, so nothing may say they are').not.toContainText('and they are signed out');
});

// WHAT BECAME OF A RESET IS A REPORT (whole-app check, 17 Nov 2026). It came in the question's dialog, "Cancel"
// beside "OK" — and beside a reset that had already happened, Cancel read as a way to undo it. And once it was read,
// focus went back to the button that opened it, which the list had re-drawn by then, so it fell to the page.
test('operations: a reset\'s report has one button, OK — and closing it returns focus to that row\'s Reset', async ({ page }) => {
    const { row, name } = await openForReset(page, { answer: { ok: true, revoked: true, stamped: true, notified: false } });
    await row.locator('.btn-acct-reset').focus();
    await page.keyboard.press('Enter');
    await page.locator('.lb-overlay.open .dialog-btn-confirm').click();       // the question: Reset
    const report = page.locator('.lb-overlay.open').filter({ hasText: 'they have NOT been told' });
    await expect(report).toBeVisible();
    await expect(report.locator('.dialog-btn-cancel'), 'nothing to cancel: the reset has happened').toHaveCount(0);
    await expect(report.locator('.dialog-btn-confirm')).toHaveText('OK');
    await expect(report.locator('.dialog-btn-confirm')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('.lb-overlay.open')).toHaveCount(0);
    await expect(page.locator(`.acct-row[data-member="${name}"] .btn-acct-reset`), 'focus fell to the page').toBeFocused();
});

// A NOTIFICATION TAP IS NOT A BACK PRESS (whole-app check, 17 Nov 2026). Tapped while Operations is open, a push is a
// hash navigation of this page, which fires popstate before hashchange — and overlay.js reads every popstate as
// Android Back, so the tap closed whatever was open: the "Reset password?" question vanished, and the entry the tap
// pushed stayed behind as a Back press that did nothing. The Calendar's own hashes have been claimed since 10 Nov.
test('operations: a notification tap leaves an open question open, and takes its own history entry back off', async ({ page }) => {
    await page.addInitScript(() => { /** @type {any} */ (window).__E2E = { authUser: true, docs: [], docsByPath: { staffContact: [], passwordStatus: [], resetRequests: [] } }; });
    await page.route(/getAccountSetupGaps|getSignInStats/, route => route.abort('failed'));   // hermetic
    await seedSession(page, 'G. Miller');
    await page.goto('/operations.html');
    await page.evaluate(() => document.getElementById('accountStatusBody')?.classList.add('open'));
    await page.locator('.acct-row').first().locator('.btn-acct-reset').click();
    const question = page.locator('.lb-overlay.open').filter({ hasText: 'Reset password?' });
    await expect(question).toBeVisible();
    await expect.poll(() => page.evaluate(() => history.state?.mybOverlay), 'premise: the question has its Back entry').toBe(true);
    await page.evaluate(() => { location.hash = '#reset-requests'; });          // the reset-request push, tapped
    await expect(page.locator('#resetRequestsBody'), 'the tap was followed').toHaveClass(/\bopen\b/);
    await expect.poll(() => page.evaluate(() => location.hash)).toBe('');
    await expect(question, 'the tap was read as Back, and closed the question').toBeVisible();
    await expect.poll(() => page.evaluate(() => history.state?.mybOverlay), 'the tap\'s entry was left behind').toBe(true);
    await page.evaluate(() => history.back());                                   // ONE Back closes the question
    await expect(question).toBeHidden();
});

// A 500 SAYS WHAT THE SERVER SAID (sign-in audit, Nov 2026): the endpoint's 500 now carries a sentence — that it is not known
// whether the password changed, or that nothing did — and it is shown as written, as the 503's has been, under a title
// that claims neither. A page from in front of the function is still not a reason.
for (const [what, o, shown] of /** @type {Array<[string, any, boolean]>} */ ([
    ['its sentence', { status: 500, answer: { error: 'It isn’t known whether the password changed — resetting again is safe.' } }, true],
    ['nothing, when the answer is a web page', { status: 500, body: '<!DOCTYPE html><title>Error 500</title><p>Server Error' }, false],
    ['nothing, when its sentence is markup', { status: 500, answer: { error: '<p>Internal Server Error</p>' } }, false],
])) {
    test(`operations: a reset the server answered 500 shows ${what}, beside Retry`, async ({ page }) => {
        const { row } = await openForReset(page, o);
        await pressReset(page, row);
        await expect(row.locator('.btn-acct-reset')).toHaveText('Retry');
        if (shown) {
            const dialog = page.locator('.lb-overlay.open');
            await expect(dialog.locator('.dialog-title')).toHaveText('The reset ran into a problem');
            await expect(dialog.locator('.dialog-message')).toHaveText(o.answer.error);
        } else {
            // "Retry" and a dialog are written in the same task, so once the one is seen the other would exist — any
            // dialog but the question itself, which is still fading out.
            await expect(page.locator('.dialog-overlay').filter({ hasNotText: 'Reset password?' })).toHaveCount(0);
        }
    });
}

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

// The upload receipts printed the date input's raw value — "Circular uploaded for 2026-11-10" — where
// app copy writes a date in words (CLAUDE.md; Nov 2026 review, cal-docs-18).
for (const [card, file, words] of [['circularUpload', 'circularFileInput', 'Circular uploaded for'],
                                   ['newsletterUpload', 'newsletterFileInput', 'Newsletter uploaded for']]) {
    test(`operations: the ${card.replace('Upload', '')} receipt names its date in words, not as an ISO string`, async ({ page }) => {
        await seedSession(page, 'G. Miller');
        await page.goto('/operations.html');
        await page.evaluate((id) => document.getElementById(`${id}Body`)?.classList.add('open'), card);
        await page.setInputFiles(`#${file}`, { name: 'doc.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 fixture') });
        await page.locator(`#${card === 'circularUpload' ? 'circular' : 'newsletter'}UploadBtn`).click();
        const feedback = page.locator(`#${card === 'circularUpload' ? 'circular' : 'newsletter'}Feedback`);
        await expect(feedback).toContainText(words);
        await expect(feedback).toHaveText(new RegExp(`${words} \\d{1,2} [A-Z][a-z]{2} \\d{4} —`));
        await expect(feedback).not.toHaveText(/\d{4}-\d{2}-\d{2}/);
    });
}

// An upload whose account went mid-save may still land, so the admin is sent to LOOK — and told where,
// as the Huddle card does (whole-app check, 10 Nov 2026; cal-docs NAA 5). It said "…then check whether
// it saved", with nowhere named.
// The Newsletter's ☰ button offers an issue for six weeks from its date (newsletter-recency.js, owner,
// 14 Nov 2026), so an older issue is nowhere on the menu: its #newsletter link still opens the latest
// issue, and that is where the admin is sent. The date is the one the upload is filed under.
/** Set an upload card's (hidden, picker-driven) date field to `iso`. */
const setUploadDate = (/** @type {import('@playwright/test').Page} */ page, /** @type {string} */ prefix, /** @type {string} */ iso) =>
    page.evaluate(([p, d]) => {
        const el = /** @type {HTMLInputElement} */ (document.getElementById(`${p}Date`));
        el.value = d; el.dispatchEvent(new Event('change', { bubbles: true }));
    }, [prefix, iso]);
// An issue too old for the menu was sent to "the Calendar with #newsletter on the end of its address" — words for a
// developer, and a link that opens the NEWEST issue, not the one just filed (whole-app check, 17 Nov 2026). A second
// upload for the same date replaces the first, so that is the check offered now.
for (const [prefix, drawer, issue] of /** @type {[string, string, string|null][]} */ ([
    ['circular', '☰ → Weekly Retail Circular', null],
    ['newsletter', '☰ → Marylebone Newsletter', isoDaysAgo(2)],
    ['newsletter', 'whether it saved — the ☰ menu won’t offer an issue that old, so upload it again if you are not sure', isoDaysAgo(60)],
])) {
    test(`operations: a ${prefix} upload signed out mid-save says where to check${issue === null ? '' : issue === isoDaysAgo(60) ? ' — an issue too old for the ☰ menu' : ' — a recent issue'}`, async ({ page }) => {
        await page.addInitScript(() => {
            const w = /** @type {any} */ (window);
            w.__E2E = { ...(w.__E2E || {}), failSetCode: 'auth/signed-out-during-request' };
        });
        await seedSession(page, 'G. Miller');
        await page.goto('/operations.html');
        await page.evaluate((p) => document.getElementById(`${p}UploadBody`)?.classList.add('open'), prefix);
        if (issue) await setUploadDate(page, prefix, issue);
        await page.setInputFiles(`#${prefix}FileInput`, { name: 'doc.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 fixture') });
        await page.locator(`#${prefix}UploadBtn`).click();
        await expect(page.locator(`#${prefix}Feedback`)).toHaveText(
            `You were signed out before this upload was confirmed. Sign in again, then check ${drawer}.`);
    });
}

// ── A RECEIPT SAYS WHETHER STAFF WILL BE SHOWN IT (whole-app check, 17 Nov 2026) ────────────────────────
// Staff are only ever shown the newest of each kind, so an upload dated before one already filed is kept and never
// offered — and its receipt said they would see it. Each card now asks, as it uploads, for the newest of its kind.
for (const [prefix, collection, noun] of /** @type {const} */ ([
    ['huddle', 'huddles', 'Huddle'], ['circular', 'circulars', 'Circular'], ['newsletter', 'newsletters', 'Newsletter'],
])) {
    test(`operations: a ${noun} dated before the newest one filed says staff won't see it`, async ({ page }) => {
        const newest = isoDaysAgo(0);
        await page.addInitScript(([col, date]) => {
            const w = /** @type {any} */ (window);
            w.__E2E = { ...(w.__E2E || {}), docsByQuery: { [col]: [{ id: date, date, fileType: 'pdf',
                storageUrl: `https://firebasestorage.googleapis.com/v0/b/myb-roster.appspot.com/o/${col}%2F${date}.pdf?alt=media` }] } };
        }, [collection, newest]);
        await seedSession(page, 'G. Miller');
        await page.goto('/operations.html');
        await page.evaluate((p) => document.getElementById(p === 'huddle' ? 'huddleBody' : `${p}UploadBody`)?.classList.add('open'), prefix);
        await setUploadDate(page, prefix, isoDaysAgo(3));
        await page.setInputFiles(`#${prefix}FileInput`, { name: 'doc.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 fixture') });
        await page.locator(`#${prefix}UploadBtn`).click();
        await expect(page.locator(`#${prefix}Feedback`)).toHaveText(new RegExp(
            `^${noun} uploaded for \\d{1,2} [A-Z][a-z]{2} \\d{4} — but staff are shown the newest one, dated \\d{1,2} [A-Z][a-z]{2} \\d{4}, so they won’t see this one\\.$`));
    });
}

// ── THE NEWSLETTER CARD STATES THE SIX-WEEK RULE, AND ITS RECEIPT APPLIES IT (owner, 14 Nov 2026) ─────
// Its header and ? panel say how long the ☰ button offers an issue; the receipt says whether THIS upload
// will be offered, from the date it was filed under. The words are operations.html and operations-tips.js.
test('operations: the Newsletter card says staff open it from ☰ for six weeks after its date', async ({ page }) => {
    await seedSession(page, 'G. Miller');
    await page.goto('/operations.html');
    await expect(page.locator('#newsletterUploadHint')).toHaveText('PDF or Word — staff open it from ☰ → Marylebone Newsletter for six weeks after its date');
    await page.locator('.btn-card-tips[data-card="newsletter"]').click();
    const tips = page.locator('#tipsLightboxContent');
    await expect(tips).toContainText('staff open it from ☰ → Marylebone Newsletter');
    await expect(tips).toContainText('The ☰ button offers each issue for six weeks from its date, then hides until the next upload');
    await expect(tips).toContainText('the six weeks are counted from it');
});

for (const [label, issue, told] of /** @type {[string, () => string, string][]} */ ([
    ['today’s issue', () => '', 'staff can open it from ☰ → Marylebone Newsletter'],
    ['an issue six weeks old', () => isoDaysAgo(42), 'it is six weeks old or more by its date, so the ☰ menu won’t offer it'],
])) {
    test(`operations: the Newsletter receipt for ${label} says whether the ☰ menu will offer it`, async ({ page }) => {
        await seedSession(page, 'G. Miller');
        await page.goto('/operations.html');
        await page.evaluate(() => document.getElementById('newsletterUploadBody')?.classList.add('open'));
        if (issue()) await setUploadDate(page, 'newsletter', issue());
        await page.setInputFiles('#newsletterFileInput', { name: 'doc.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 fixture') });
        await page.locator('#newsletterUploadBtn').click();
        const toldPattern = told.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        await expect(page.locator('#newsletterFeedback')).toHaveText(
            new RegExp(`^Newsletter uploaded for \\d{1,2} [A-Z][a-z]{2} \\d{4} — ${toldPattern}$`));
    });
}

test('operations: uploading a recent issue brings the ☰ button back on this device at once, and an older one does not', async ({ page }) => {
    await page.addInitScript((k) => { try { localStorage.setItem(k, '2026-07-31'); } catch { /* none */ } }, NEWSLETTER_LATEST_KEY);
    await seedSession(page, 'G. Miller');
    await page.goto('/operations.html');
    const row = page.locator('#navPanel .nav-panel-link--newsletter');
    // The open drawer's Latest list, read off the screen — "not offered" is the Huddle and the Circular
    // SHOWING without it, so it cannot pass on a drawer that has not opened yet.
    const latest = page.locator('#navPanel .nav-panel-links').first().locator('.nav-panel-link').filter({ visible: true });
    await page.locator('#navMenuBtn').click();
    await expect(latest, 'premise: July’s issue is not offered').toHaveText([/Daily Huddle/, /Weekly Retail Circular/]);
    await page.locator('#navPanelClose').click();

    const upload = async (/** @type {string} */ iso) => {
        await page.evaluate(() => document.getElementById('newsletterUploadBody')?.classList.add('open'));
        await setUploadDate(page, 'newsletter', iso);
        await page.setInputFiles('#newsletterFileInput', { name: 'doc.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 fixture') });
        await page.locator('#newsletterUploadBtn').click();
        await expect(page.locator('#newsletterFeedback')).toContainText('Newsletter uploaded for');
    };
    await upload(isoDaysAgo(60));   // a back issue, filed for the record
    await page.locator('#navMenuBtn').click();
    await expect(latest, 'an issue too old for the menu was offered').toHaveText([/Daily Huddle/, /Weekly Retail Circular/]);
    await page.locator('#navPanelClose').click();

    await upload(isoDaysAgo(1));
    await page.locator('#navMenuBtn').click();
    await expect(row, 'the issue just uploaded is not on this device’s menu').toBeVisible();
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

// A SAVE STILL GOING OUT IS BUSY, WHATEVER THE SCREEN SHOWS (Nov 2026 review). The page's busy check
// looked only at what was on screen, so a roster save in several parts whose review the admin had
// dismissed ("Upload a different file") read as not busy — and an update's reload, or a notification
// tap, would take the page away with the later parts unsent. Asked here the way the worker asks.
test('operations: a roster save still sending is busy, even with its review off the screen', async ({ page }) => {
    await page.addInitScript(() => { /** @type {any} */ (window).__E2E = { .../** @type {any} */ (window).__E2E, holdCommits: true }; });
    await seedSession(page, 'G. Miller');
    await openRosterReview(page);
    await page.locator('#rosterApplyBtn').click();                     // the first part is held on the device
    // "Upload a different file" is refused while a save is out (import-client-1, the next test), so
    // the review is taken off the screen directly: what is proved is that the check reads the
    // WRITES, not the screen — the screen's three checks all read "not busy" from here.
    await page.locator('#rosterReviewSection').evaluate(el => el.classList.remove('visible'));
    const busy = await page.evaluate(() => new Promise(resolve => {
        const ch = new MessageChannel();
        ch.port1.onmessage = (e) => resolve(e.data?.busy);
        navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: { type: 'myb-busy?' }, ports: [ch.port2] }));
    }));
    expect(busy, 'a reload now would strand the parts not yet sent').toBe(true);
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

// v25.92: a day a colleague changed between the read and the Save. The review loaded m1 (a manual
// Tuesday shift) and a manager rewrote it before the admin pressed Save over it with "Use new roster".
// The Save is refused — nothing written, not even the other rows in its part — the day is named, and the
// review is redrawn from the latest, so the row now shows the colleague's value. No second read of the PDF.
test('operations: a roster Save over a day changed since the read is refused, named, and the review redrawn', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await seedSession(page, 'G. Miller');
    await openRosterReview(page);
    const conflict = page.locator('.roster-change-row', { has: page.locator('.roster-choice-btn[data-pick="pdf"]') }).first();
    await expect(conflict).toContainText('23:00-06:00');
    // A manager rewrites the Tuesday the review loaded — on the server, so on the Save's re-read and any later read.
    await page.evaluate(() => {
        const e2e = /** @type {any} */ (window).__E2E;
        Object.assign(e2e.docs.find((/** @type {any} */ r) => r.id === 'm1'), { value: '14:00-22:00' });
        e2e.txDocs = e2e.docs;
    });
    await conflict.locator('.roster-choice-btn[data-pick="pdf"]').click();
    await page.locator('#rosterApplyBtn').click();
    await expect(page.locator('#rosterApplyFeedback')).toContainText(
        'Nothing was saved: G. Miller on Tue 4 Aug changed after the roster was read. The review now shows that day as it is');
    expect(await page.evaluate(() => (/** @type {any} */ (window).__E2E.batchWrites || []).length), 'nothing written').toBe(0);
    expect(await page.evaluate(() => (/** @type {any} */ (window).__E2E.batchDeletes || []).length), 'nothing deleted').toBe(0);
    // Redrawn, not closed: the row shows the colleague's value, its choice reset, and Save is offered again.
    await expect(page.locator('#rosterReviewSection')).toHaveClass(/visible/);
    await expect(conflict).toContainText('14:00-22:00');
    await expect(conflict).not.toContainText('23:00-06:00');
    await expect(page.locator('#rosterApplyBtn')).toHaveText(/Save 3 changes/);
    await expect(page.locator('#rosterApplyBtn')).toBeEnabled();
    // Chosen again over what the day now holds, the Save goes through — and deletes the colleague's record it was shown.
    await conflict.locator('.roster-choice-btn[data-pick="pdf"]').click();
    await page.locator('#rosterApplyBtn').click();
    await expect(page.locator('#rosterApplyFeedback')).toContainText('Done — 4 changes applied');
    expect(await page.evaluate(() => (/** @type {any} */ (window).__E2E.batchDeletes || []).filter((/** @type {string} */ p) => /\/m1$/.test(p)).length)).toBe(1);
});

// v25.94 (the 13 Nov review): the refusal's redraw put EVERY row back to its default, so a row the admin
// had unticked came back ticked and the second Save wrote it, while the message named only Tuesday. Now
// each row keeps its answer unless its own day changed — here an untick and a picked reading survive,
// and only the changed Tuesday is asked again.
test('operations: a refused roster Save keeps every answer but the changed day\'s', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await seedSession(page, 'G. Miller');
    await openRosterReview(page);
    const save = page.locator('#rosterApplyBtn');
    const monday = page.locator('.roster-change-row[data-key="G. Miller|2026-08-03"] .roster-tick');
    const fridayAL = page.locator('.roster-choice-btn[data-key="G. Miller|2026-08-07"][data-opt="0"]');
    const tuesday = page.locator('.roster-change-row', { has: page.locator('.roster-choice-btn[data-pick="pdf"]') }).first();
    await expect(save).toHaveText(/Save 3 changes/);
    await monday.click();                                              // left out — a misread, say
    await expect(monday).toHaveAttribute('aria-pressed', 'false');
    await fridayAL.click();                                            // an unreadable cell, answered
    await expect(fridayAL).toHaveAttribute('aria-pressed', 'true');
    await page.evaluate(() => {                                        // a manager rewrites Tuesday on the server
        const e2e = /** @type {any} */ (window).__E2E;
        Object.assign(e2e.docs.find((/** @type {any} */ r) => r.id === 'm1'), { value: '14:00-22:00' });
        e2e.txDocs = e2e.docs;
    });
    await tuesday.locator('.roster-choice-btn[data-pick="pdf"]').click();
    await save.click();
    await expect(page.locator('#rosterApplyFeedback')).toContainText('Nothing was saved: G. Miller on Tue 4 Aug changed after the roster was read');
    // Redrawn: the two answers stand, Tuesday is asked again over what it now holds.
    await expect(monday).toHaveAttribute('aria-pressed', 'false');
    await expect(fridayAL).toHaveAttribute('aria-pressed', 'true');
    await expect(tuesday.locator('.roster-choice-btn[data-pick="manual"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(tuesday).toContainText('14:00-22:00');
    await expect(save).toHaveText(/Save 3 changes/);
    await save.click();
    await expect(page.locator('#rosterApplyFeedback')).toContainText('Done — 3 changes applied');
    const written = await page.evaluate(() => (/** @type {any} */ (window).__E2E.batchWrites || []).map((/** @type {any} */ w) => w.date));
    expect(written, 'the Monday the admin left out is not written').not.toContain('2026-08-03');
    expect(written, 'the answered Friday is').toContain('2026-08-07');
});

// …and Skip all, which belongs to a PERSON rather than a row: the page presses it again after the
// redraw, so a skipped person stays skipped, and Restore still puts back the ticks they had.
test('operations: a refused roster Save keeps a skipped person skipped, and Restore still restores', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const MON = '2026-08-03';
    // A second current member who works that Monday: their week as the base roster has it, but Monday changed.
    const other = /** @type {any} */ (teamMembers.find((/** @type {any} */ m) => !m.hidden && !m.managerOnly && m.rosterType === 'main'
        && m.name !== 'G. Miller' && /^\d/.test(getBaseShift(m, new Date(MON + 'T12:00:00')))));
    const shifts = Object.fromEntries(ROSTER_REVIEW_DATES.map(d => [d, getBaseShift(other, new Date(d + 'T12:00:00'))]));
    shifts[MON] = shifts[MON] === '13:00-21:00' ? '06:00-14:00' : '13:00-21:00';
    await seedSession(page, 'G. Miller');
    await openRosterReview(page, { ...ROSTER_REVIEW_PARSE, parsed: [...ROSTER_REVIEW_PARSE.parsed, { memberName: other.name, shifts }] });
    const save = page.locator('#rosterApplyBtn');
    const section = page.locator(`.roster-person-section[data-member="${other.name}"]`);
    const skipAll = section.locator('.roster-skip-all-btn');
    await expect(save).toHaveText(/Save 4 changes/);
    await skipAll.click();
    await expect(save).toHaveText(/Save 3 changes/);
    await page.evaluate(() => {                                        // a manager rewrites G. Miller's Tuesday
        const e2e = /** @type {any} */ (window).__E2E;
        Object.assign(e2e.docs.find((/** @type {any} */ r) => r.id === 'm1'), { value: '14:00-22:00' });
        e2e.txDocs = e2e.docs;
    });
    await page.locator('.roster-choice-btn[data-pick="pdf"]').first().click();
    await save.click();
    await expect(page.locator('#rosterApplyFeedback')).toContainText('Nothing was saved');
    await expect(section).toHaveClass(/section-skipped/);
    await expect(skipAll).toHaveText('Restore');
    await expect(save).toHaveText(/Save 3 changes/);
    // Restore puts back the tick the row had before Skip all — what was remembered survived the redraw.
    await skipAll.click();
    await expect(section.locator('.roster-tick').first()).toHaveAttribute('aria-pressed', 'true');
    await expect(save).toHaveText(/Save 4 changes/);
});

// v25.94: a part of the Save that DELETES is a transaction, which no device holds — so its slow notice
// asks the admin to keep the page open and never says the change is held and will send by itself. A
// part that only adds is still held offline, and still says so (the second test): both directions pinned.
test('operations: a roster Save that deletes and is still waiting asks for the page to stay open', async ({ page }) => {
    await page.addInitScript(() => { window.__E2E = { ...(window.__E2E || {}), authUser: true, holdCommits: true, slowSaveMs: 300 }; });
    await seedSession(page, 'G. Miller');
    await openRosterReview(page);
    await page.locator('.roster-choice-btn[data-pick="pdf"]').first().click();   // "Use new roster": this part deletes m1
    await page.locator('#rosterApplyBtn').click();
    const notice = page.locator('#slowSaveNotice');
    await expect(notice).toBeVisible({ timeout: 5000 });
    await expect(notice).toContainText('Keep this page open');
    await expect(notice).not.toContainText('held on this device');
    await page.evaluate(() => /** @type {any} */ (window).__E2E.releaseCommits());
    await expect(page.locator('#rosterApplyFeedback')).toContainText('Done — 4 changes applied');
});

test('operations: a roster Save that only adds is still held on the device, and says so', async ({ page }) => {
    await page.addInitScript(() => { window.__E2E = { ...(window.__E2E || {}), authUser: true, holdCommits: true, slowSaveMs: 300 }; });
    await seedSession(page, 'G. Miller');
    await openRosterReview(page);
    await page.locator('#rosterApplyBtn').click();                                // three new days: nothing deleted
    const notice = page.locator('#slowSaveNotice');
    await expect(notice).toBeVisible({ timeout: 5000 });
    await expect(notice).toContainText('held on this device');
    await page.evaluate(() => /** @type {any} */ (window).__E2E.releaseCommits());
    await expect(page.locator('#rosterApplyFeedback')).toContainText('Done — 3 changes applied');
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

// A member the read listed more than once keeps ONE row on the server, and only its log knew about
// the other, so the review names each one (whole-app fix, Nov 2026). The second name is markup to
// prove it is escaped like every other name the review shows.
test('operations: a member the read listed twice is named, one escaped line each', async ({ page }) => {
    await seedSession(page, 'G. Miller');
    await openRosterReview(page, { ...ROSTER_REVIEW_PARSE, duplicateMembers: ['G. Miller', '<b>Z. Test</b>'] });
    const notes = page.locator('.roster-crosscheck-note', { hasText: 'appeared more than once in the read' });
    await expect(notes).toHaveCount(2);
    await expect(notes.nth(0)).toHaveText(
        '⚠ G. Miller appeared more than once in the read; the first row that was not empty was used. Check it against the PDF.');
    await expect(notes.nth(1)).toContainText('<b>Z. Test</b> appeared more than once in the read');
    await expect(notes.nth(1).locator('b')).toHaveCount(0);
});

// An older Function sends no `duplicateMembers`, so either release order is safe: absent is none.
test('operations: a read with no duplicate list, as an older Function sends, names nobody', async ({ page }) => {
    await seedSession(page, 'G. Miller');
    await openRosterReview(page);   // ROSTER_REVIEW_PARSE has no duplicateMembers field
    await expect(page.locator('.roster-crosscheck-note').first()).toBeVisible();
    await expect(page.locator('#rosterChangeList')).not.toContainText('appeared more than once');
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

// A keyboard user on a strip link KEEPS it when the strip updates (Nov 2026 review). Every report
// rebuilt the strip, and one arrives on every return to the tab — so the link they had tabbed to was
// destroyed and focus fell to the page. The strip now changes an item's words in place.
test('operations: a strip link keeps keyboard focus when the strip updates under it', async ({ page }) => {
    await seedSession(page);
    await page.addInitScript(() => {
        /** @type {any} */ (window).__E2E = { docs: [{ id: 'A. Hared', requestedAt: Date.now() - 60_000, count: 1, provisioned: true }] };
    });
    await page.goto('/operations.html');
    const link = page.locator('#attentionStrip').getByRole('link', { name: 'Password resets: 1 waiting' });
    await link.focus();
    await page.evaluate(() => {
        const w = /** @type {any} */ (window);
        w.__E2E.docs.push({ id: 'K. Jedlinski', requestedAt: Date.now(), count: 1, provisioned: true });
        document.dispatchEvent(new Event('visibilitychange'));       // back to the tab: the queue re-reads
    });
    const updated = page.locator('#attentionStrip').getByRole('link', { name: 'Password resets: 2 waiting' });
    await expect(updated).toBeVisible();
    await expect(updated, 'the re-report destroyed the focused link').toBeFocused();
});

// ── OFFLINE: A READ THE CACHE ANSWERED IS A FAILED LOAD (settings-ops-1, Nov 2026) ──────────────
// Offline, Firestore does not fail a read: it answers from this device's cache, as of whenever it last
// heard, an empty queue included, and every card painted that as the server's answer. So the admin met
// "✓ No outstanding requests" beside a member who was locked out, with nothing on the strip, and
// Account status said "0/51" on a device that had never held the table. `docsFromCache` is that cache
// answer. The readers now refuse it, so each card's own "Couldn't load … Try again" answers instead.

/**
 * A refusal is its card's to answer, so none reaches the Error Log as a bug: no uncaught error or
 * rejection (what error-reporter.js listens for), and no `clientErrors` record written.
 * @param {import('@playwright/test').Page} page @param {string[]} pageErrors from collectFatalErrors
 */
async function expectNothingForTheErrorLog(page, pageErrors) {
    expect(pageErrors, 'an escaped error is what the Error Log records').toEqual([]);
    const logged = await page.evaluate(() => (/** @type {any} */ (window).__E2E.setWrites || [])
        .filter((/** @type {any} */ w) => w.path === 'clientErrors').map((/** @type {any} */ w) => w.data?.message));
    expect(logged, 'nothing written to the Error Log').toEqual([]);
}

test('operations offline: an empty reset queue from the cache says it could not load, not "No outstanding requests"', async ({ page }) => {
    const pageErrors = collectFatalErrors(page);
    await page.addInitScript(() => { /** @type {any} */ (window).__E2E = { docs: [], docsFromCache: true }; });
    await seedSession(page, 'G. Miller');
    await page.goto('/operations.html');
    const queue = page.locator('#resetRequestsContent');
    await expect(queue).toContainText('Couldn’t load the password reset requests — check your connection.');
    await expect(queue, 'a cache that never heard of a request is not "nothing outstanding"').not.toContainText('No outstanding requests');
    await expect(queue.locator('.card-retry-btn'), 'the card offers its retry (the card itself stays collapsed)').toHaveText('↻ Try again');
    await expect(page.locator('#resetRequestsCountChip')).toHaveText('');
    // …and the strip says so too (owner, 10 Nov 2026): the card stays closed, so a strip with no
    // reset item read exactly like "nothing outstanding".
    await expect(page.locator('#attentionStrip').getByRole('link', { name: 'Password resets: couldn’t check' }),
        'a queue that could not be read is not absent from the strip, like a clean one').toBeVisible();
    await expectNothingForTheErrorLog(page, pageErrors);
});

test('operations offline: Account status from the cache says it could not load, not "0/51"', async ({ page }) => {
    const pageErrors = collectFatalErrors(page);
    await page.addInitScript(() => { /** @type {any} */ (window).__E2E = { docs: [], docsFromCache: true }; });
    await seedSession(page, 'G. Miller');
    await page.goto('/operations.html');
    const accounts = page.locator('#accountStatusContent');
    await expect(accounts).toContainText('Couldn’t load the account status — check your connection.');
    await expect(accounts.locator('.acct-summary'), 'no "0/51" from a table the device may never have held').toHaveCount(0);
    await expectNothingForTheErrorLog(page, pageErrors);
});

test('operations offline: a re-read the cache answers says "couldn’t check" on the strip, rather than vouching for it', async ({ page }) => {
    const pageErrors = collectFatalErrors(page);
    await page.addInitScript(() => {
        /** @type {any} */ (window).__E2E = { docsByPath: { resetRequests: [
            { id: 'A. Hared', requestedAt: Date.now() - 60_000, count: 1, provisioned: true },
        ] } };
    });
    await seedSession(page, 'G. Miller');
    await page.goto('/operations.html');
    const strip = page.locator('#attentionStrip');
    await expect(strip.getByRole('link', { name: 'Password resets: 1 waiting' }), 'premise: the server\'s answer is on the strip').toBeVisible();

    // The phone wakes with no signal: the page re-reads on its return, and the cache answers with the
    // copy it holds — which could be hours old, and says nothing of a request made since.
    await page.evaluate(() => {
        /** @type {any} */ (window).__E2E.docsFromCache = true;
        document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(page.locator('#resetRequestsContent')).toContainText('Couldn’t load the password reset requests');
    await expect(page.locator('.rr-row')).toHaveCount(0);
    await expect(page.locator('#resetRequestsCountChip')).toHaveText('');
    // The old count is not restated, and the item is not withdrawn either — withdrawn read as clean
    // from outside the closed card (owner, 10 Nov 2026).
    const item = strip.locator('a[href="#reset-requests"]');
    await expect(item, 'an unknown count says it could not check').toHaveAccessibleName('Password resets: couldn’t check');
    await expect(item.locator('.attn-count')).toHaveText('couldn’t check');
    await expect(item.locator('.attn-count'), 'not the count\'s alarm red').toHaveClass(/attn-count--unchecked/);
    // …and the class does what it says: the PAINTED colour is not a count's red. (The class alone
    // proves nothing if the rule that recolours it loses to .errorlog-count-chip.)
    const painted = await item.locator('.attn-count').evaluate((el) => getComputedStyle(el).color);
    const alarm = await page.evaluate(() => {
        const s = document.createElement('span');
        s.className = 'card-year-chip errorlog-count-chip attn-count';
        document.body.append(s);
        const c = getComputedStyle(s).color;
        s.remove();
        return c;
    });
    expect(painted, 'a failed check is painted in the count\'s alarm red').not.toBe(alarm);
    await expectNothingForTheErrorLog(page, pageErrors);
});

test('operations offline: App speed, Usage and the Error Log refuse a cached answer too', async ({ page }) => {
    const pageErrors = collectFatalErrors(page);
    await page.addInitScript(() => {
        /** @type {any} */ (window).__E2E = { docsFromCache: true,
            // A cached copy for every card, so one that ignored where its answer came from would paint
            // it: speed samples and page views (every single-document read gets this one object) and
            // an unresolved error.
            getDocData: { samples: { '25_64|calendar|ready|lt500ms|standalone|4g': 300 }, counts: { calendar: 1284 } },
            docsByPath: { resetRequests: [], staffContact: [], passwordStatus: [] },
            docs: [{ id: 'err1', memberName: 'G. Miller', page: 'admin.html', message: 'boom', stack: '', appVersion: 'x', userAgent: 'ua', timestamp: Date.now(), resolved: false }],
        };
    });
    await seedSession(page, 'G. Miller');
    await page.goto('/operations.html');
    await expect(page.locator('#pageSpeedContent')).toContainText('Couldn\'t load app speed — check your connection.');
    await expect(page.locator('#usageContent')).toContainText('Couldn\'t load usage — check your connection.');
    await expect(page.locator('#errorLogContent')).toContainText('Couldn\'t load error log — check your connection.');
    await expect(page.locator('#errorLogCountChip')).toHaveText('');
    await expect(page.locator('#attentionStrip a[href="#error-log"]')).toHaveCount(0);
    await expectNothingForTheErrorLog(page, pageErrors);
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
    // …and stays readable under a mouse: the plain button's hover rule outweighed the variant and
    // turned its words navy on its own navy fill. Read once the colour has finished easing.
    await remedy.hover();
    const hovered = await remedy.evaluate(async el => {
        await Promise.all(el.getAnimations().map(a => a.finished));
        const c = getComputedStyle(el);
        return { text: c.color, fill: c.backgroundColor };
    });
    expect(hovered.text, 'the remedy\'s words vanish into its fill under the pointer').not.toBe(hovered.fill);
    expect(hovered.text).toBe('rgb(255, 255, 255)');

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
    await expect(speed).toContainText('Counted since late October 2026.');
    await expect(speed, 'a version number is developer-speak in the admin\'s copy').not.toContainText('Counted from v');
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

// THE STAFF PIN SHUT FOR EVERYONE (owner, Nov 2026). It rides on the same account check: an object while
// a block runs (or began in the last day) puts an item on the strip and a line on the card it opens; an
// answer WITHOUT the field — an older server, or a record the server could not read — must show neither,
// and above all must not read as "the PIN is fine". The rules are operations-pin-lockout.test.mjs's.
test('operations: a staff PIN blocked for everyone reaches the strip and Staff Login Accounts', async ({ page }) => {
    await seedSession(page);
    await page.addInitScript(() => { window.__E2E = { ...(window.__E2E || {}), authUser: true }; });
    await page.route(GAPS_URL, route => route.fulfill({
        status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({ setUp: [], leavers: [], pinLockout: {
            active: true, blockedUntil: Date.now() + 10 * 60_000, lastBlockedAt: Date.now() - 5 * 60_000, blocks: 2 } }),
    }));
    await page.goto('/operations.html');
    const strip = page.locator('#attentionStrip');
    await expect(strip.getByRole('link', { name: 'Staff PIN blocked: 2 times in the last day' })).toBeVisible();
    await strip.locator('a[href="#login-accounts"]').first().click();
    await expect(page.locator('#authSetupBody')).toHaveClass(/open/);
    const line = page.locator('#authSetupGaps .auth-gap-line--pin');
    await expect(line).toContainText(/The staff PIN is blocked for everyone until \d{2}:\d{2}/);
    await expect(line).toContainText('members can still sign in with their password');
    await expect(page.locator('#authSetupGaps')).toContainText('Everyone on the roster has a login');
});

// ASKED AGAIN WHEN THE PUSH LANDS (whole-app check, 17 Nov 2026). The audit was read once, at load, so the
// "Staff PIN — blocked station-wide" push, tapped with Operations already open, opened Staff Login Accounts on
// an answer from before the block: no line, no strip item. The tap and a return to the tab now ask again.
/** Operations with the account audit answering whatever `answer()` says at the time. @param {import('@playwright/test').Page} page @param {() => any} answer */
async function openWithAudit(page, answer) {
    await seedSession(page);
    await page.addInitScript(() => { window.__E2E = { ...(window.__E2E || {}), authUser: true }; });
    await page.route(GAPS_URL, route => route.fulfill({
        status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(answer()),
    }));
    await page.goto('/operations.html');
    await expect(page.locator('#authSetupGaps')).toContainText('Everyone on the roster has a login');
}
const RUNNING_BLOCK = () => ({ active: true, blockedUntil: Date.now() + 10 * 60_000, lastBlockedAt: Date.now() - 60_000, blocks: 1 });

test('operations: the staff-PIN push on an OPEN page asks the audit again, and the block is on the card it opens', async ({ page }) => {
    let answer = { setUp: [], leavers: [], pinLockout: null };
    await openWithAudit(page, () => answer);
    await expect(page.locator('#authSetupGaps .auth-gap-line--pin')).toHaveCount(0);
    answer = { setUp: [], leavers: [], pinLockout: RUNNING_BLOCK() };     // the block begins; its push is tapped
    await page.evaluate(() => { location.hash = '#login-accounts'; });
    await expect(page.locator('#authSetupBody')).toHaveClass(/open/);
    await expect(page.locator('#authSetupGaps .auth-gap-line--pin')).toContainText(/The staff PIN is blocked for everyone until \d{2}:\d{2}/);
    await expect(page.locator('#attentionStrip').getByRole('link', { name: 'Staff PIN blocked: 1 time in the last day' })).toBeVisible();
    await expect.poll(() => page.evaluate(() => location.hash), 'followed, then taken off the address').toBe('');
});

test('operations: a return to the tab asks the account audit again', async ({ page }) => {
    let answer = /** @type {any} */ ({ setUp: [], leavers: [] });
    await openWithAudit(page, () => answer);
    answer = { setUp: [], leavers: ['Z. Example'], pinLockout: RUNNING_BLOCK() };
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    const strip = page.locator('#attentionStrip');
    await expect(strip.getByRole('link', { name: 'Leavers still active: 1' })).toBeVisible();
    await expect(strip.getByRole('link', { name: 'Staff PIN blocked: 1 time in the last day' })).toBeVisible();
});

test('operations: an account check that says nothing about the PIN shows nothing about it', async ({ page }) => {
    await seedSession(page);
    await page.addInitScript(() => { window.__E2E = { ...(window.__E2E || {}), authUser: true }; });
    await page.route(GAPS_URL, route => route.fulfill({
        status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({ setUp: [], leavers: ['Z. Example'] }),
    }));
    await page.goto('/operations.html');
    const strip = page.locator('#attentionStrip');
    await expect(strip.getByRole('link', { name: 'Leavers still active: 1' })).toBeVisible();
    await expect(strip.locator('text=Staff PIN')).toHaveCount(0);
    await expect(page.locator('#authSetupGaps .auth-gap-line--pin')).toHaveCount(0);
});

// WHAT PRESSING WILL DO, SAID BEFORE IT IS PRESSED (sign-in audit E6, 13 Nov 2026). Set up accounts takes back an account
// with no permissions at all and re-enables a disabled one, each on the surname default with every device signed out —
// and both were listed with "Press Set up accounts below." alone. The card, its ? panel and the reset queue's ? panel
// now say it; the names are admin-auth.test.mjs's to pin, this proves the real page shows them.
test('operations: the account gaps name who Set up accounts will reset, before it is pressed', async ({ page }) => {
    await seedSession(page);
    await page.addInitScript(() => { window.__E2E = { ...(window.__E2E || {}), authUser: true }; });
    await page.route(GAPS_URL, route => route.fulfill({
        status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({ setUp: [{ name: 'B. Toth', why: 'no-account' }, { name: 'S. Silva', why: 'unstamped' },
            { name: 'B. Khalil', why: 'disabled' }], leavers: [] }),
    }));
    await page.goto('/operations.html');
    await page.evaluate(() => document.getElementById('authSetupBody')?.classList.add('open'));
    const gaps = page.locator('#authSetupGaps');
    await expect(gaps).toContainText('S. Silva (no permissions)');
    await expect(gaps).toContainText('B. Khalil (account disabled)');
    await expect(gaps.locator('.auth-gap-fix')).toHaveText(['Press Set up accounts below.',
        'It will reset the passwords of S. Silva and B. Khalil to their surnames and sign them out — tell them afterwards.']);
    await expect(page.locator('#authSetupBody .auth-desc')).toContainText('resets two kinds of account to the surname default and signs them out');

    const tips = page.locator('#tipsLightboxContent');
    await page.locator('.btn-card-tips[data-card="staff-login"]').click();
    await expect(tips).toContainText('no permissions');
    await expect(tips).toContainText('disabled');
    await page.locator('#tipsLightboxClose').click();
    await expect(page.locator('#tipsLightbox')).toBeHidden();
    await page.locator('.btn-card-tips[data-card="reset-requests"]').click();
    await expect(tips).toContainText('A row saying “Account disabled” means the account is switched off');
});

// The leaver line is the one live access problem on the card, and it was the least legible text on it:
// its red on its own tint was 4.36:1, and the remedy under it was faded on top (`opacity: 0.85`,
// 3.62:1) — the line telling the admin which button closes the door. Nothing here may be faded
// (css-tokens.md → "opacity on a group"), and every line and remedy clears 4.5:1 on its own ground.
test('operations: the account-gap lines and their remedies are readable, and none is faded', async ({ page }) => {
    await seedSession(page);
    await page.addInitScript(() => { window.__E2E = { ...(window.__E2E || {}), authUser: true }; });
    await page.route(GAPS_URL, route => route.fulfill({
        status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({ setUp: [{ name: 'B. Toth', why: 'no-account' }], leavers: ['B. Khalil'] }),
    }));
    await page.goto('/operations.html');
    await page.evaluate(() => document.getElementById('authSetupBody')?.classList.add('open'));
    const gaps = page.locator('#authSetupGaps');
    await expect(gaps.locator('.auth-gap-line--leaver .auth-gap-fix'), 'premise: the leaver line and its remedy').toBeVisible();
    const m = await gaps.evaluate(root => {
        const ctx = /** @type {CanvasRenderingContext2D} */ (document.createElement('canvas').getContext('2d', { willReadFrequently: true }));
        /** @param {string} css */
        const rgb = (css) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = css; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3); };
        /** @param {number[]} c */
        const lum = (c) => c.map(v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; })
            .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
        const faded = [...root.querySelectorAll('*')].filter(el => parseFloat(getComputedStyle(el).opacity) < 1).map(el => el.className);
        const ratios = [...root.querySelectorAll('.auth-gap-line, .auth-gap-fix')].map(el => {
            const line = /** @type {Element} */ (el.closest('.auth-gap-line'));
            const [hi, lo] = [lum(rgb(getComputedStyle(el).color)), lum(rgb(getComputedStyle(line).backgroundColor))].sort((x, y) => y - x);
            return [el.className, Math.round((hi + 0.05) / (lo + 0.05) * 100) / 100];
        });
        return { faded, ratios };
    });
    expect(m.faded, 'text the admin has to read is faded with opacity').toEqual([]);
    for (const [cls, ratio] of m.ratios) expect(ratio, `${cls} is under the 4.5:1 text floor`).toBeGreaterThanOrEqual(4.5);
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

// A RE-AUDIT THAT CANNOT ANSWER TAKES ITS COUNT OFF THE STRIP (whole-app check, 10 Nov 2026;
// settings-ops-6). Reporting nothing on a failed check was right and was not enough: the strip kept
// "Leavers still active" from the load's audit beside a card saying it could no longer tell.
test('operations: a re-audit that cannot answer takes the account counts off the strip', async ({ page }) => {
    await seedSession(page);
    await page.addInitScript(() => { window.__E2E = { ...(window.__E2E || {}), authUser: true }; });
    let audits = 0;
    await page.route(GAPS_URL, route => (++audits === 1
        ? route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
            body: JSON.stringify({ setUp: [{ name: 'B. Toth', why: 'no-account' }], leavers: ['B. Khalil'] }) })
        : route.abort('failed')));
    await page.route('**/setupRosterAuth', route => route.fulfill({ status: 200, contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ created: ['B. Toth'] }) }));
    await page.goto('/operations.html');
    const strip = page.locator('#attentionStrip');
    await expect(strip.getByRole('link', { name: 'Leavers still active: 1' }), 'premise: the load\'s audit answered').toBeVisible();
    await expect(strip.getByRole('link', { name: 'Not set up: 1 member' })).toBeVisible();

    await page.locator('#authSetupToggleHeader').click();
    await page.locator('#authSetupBtn').click();   // the run re-audits, and this time nothing answers
    await expect(page.locator('#authSetupGaps')).toContainText('Couldn’t check');
    await expect(strip, 'the strip still stood behind counts the card can no longer vouch for').toBeHidden();
});

// CONFIRMING THE LEAVER DISABLE KEEPS THE FIRST RUN'S REPORT (whole-app review, Oct 2026). The
// confirm re-rendered the result box, wiping the "reset — tell them" names that only the admin
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
    // Not "Taken back": `reclaimed` also names a disabled account re-enabled — a returning leaver —
    // from whom nothing was taken (functions-core, 10 Nov 2026).
    await expect(result).toContainText('Reset to the default password and signed out (1): S. Silva');
    await page.locator('#authConfirmOrphans').click();
    await expect(result).toContainText('Disabled leavers (1): B. Khalil');
    await expect(result, 'the names only the admin can act on must survive the confirm').toContainText('S. Silva — tell them their password is their surname');
    await expect(result.locator('text=Already existed'), 'the re-run lists the whole roster again; it is not appended').toHaveCount(1);
    await expect(page.locator('#authConfirmOrphans')).toHaveCount(0);
});

// A TIER TAKEN AWAY, AND A DISABLED LEAVER'S NOTIFICATIONS, ARE REPORTED (sign-in audit D3 and D2, 13 Nov 2026). The
// server signs a member out of every device when a run takes admin, manager or Links designer from them (`demoted`),
// and a confirmed sweep switches off the notifications of leavers disabled on an earlier run
// (`disabledLeaverPushRemoved`). A member signed out unasked will ask the admin why, so both reach the result box;
// a count of nought says nothing.
test('operations: Set up accounts names who lost access, and counts a disabled leaver\'s notifications switched off', async ({ page }) => {
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
            ? { skipped: ['G. Miller'], demoted: ['S. Silva'], orphanDryRun: true, orphansToDisable: ['B. Khalil'] }
            : calls === 2 ? { skipped: ['G. Miller', 'S. Silva'], disabled: ['B. Khalil'], disabledLeaverPushRemoved: 2 }
            : { skipped: ['G. Miller', 'S. Silva'], disabled: [], disabledLeaverPushRemoved: 0 };
        return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
    });
    await page.goto('/operations.html');
    await page.locator('#authSetupToggleHeader').click();
    await page.locator('#authSetupOrphans').check();
    await page.locator('#authSetupBtn').click();
    const result = page.locator('#authSetupResult');
    await expect(result).toContainText('Access reduced and signed out of every device (1): S. Silva — they sign back in with the password they already use');
    await expect(result, 'nothing was switched off yet: the dry run releases nothing').not.toContainText('Notifications switched off');
    await page.locator('#authConfirmOrphans').click();
    await expect(result).toContainText('Notifications switched off on 2 devices of leavers disabled earlier');
    await expect(result, 'the first run\'s names survive the confirm').toContainText('S. Silva — they sign back in');

    // An answer that switched nothing off does not say it did (the run replaces the box, so the line above is gone).
    await page.locator('#authSetupOrphans').check();
    await page.locator('#authSetupBtn').click();
    await expect(result).toContainText('Already existed');
    await expect(result).not.toContainText('Notifications switched off');
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

    // THE LOCK COVERS THE WEEK (import-client-12). The read disables the week-ending field, but the field
    // is hidden behind the date picker's trigger, which ignored `disabled` — so the week could be changed
    // mid-read, and the review then answered for a different week from the one on screen.
    test('while it reads, the week-ending date is locked with its field, and freed with it', async ({ page }) => {
        await seedSession(page, 'G. Miller');
        await page.route('**/parseRosterPDF*', () => { /* never answered: the read is still running */ });
        await page.goto('/operations.html');
        await choosePdf(page);
        const trigger = page.locator('#rosterWeekEnding + .date-trigger');
        await expect(trigger).toBeEnabled();
        await page.locator('#rosterParseBtn').click();
        await expect(page.locator('#rosterParseBtn')).toBeDisabled();
        await expect(trigger, 'the week could still be changed while the read ran').toBeDisabled();
        // …and the picker itself refuses a disabled field, whoever asks it to open.
        await page.evaluate(async () => {
            const { openDatePicker } = await import('/date-picker.js');
            openDatePicker(/** @type {HTMLInputElement} */ (document.getElementById('rosterWeekEnding')));
        });
        await expect(page.locator('#datePickerLightbox.visible')).toHaveCount(0);
        await page.evaluate(() => { /** @type {HTMLInputElement} */ (document.getElementById('rosterWeekEnding')).disabled = false; });
        await expect(trigger, 'the read is over: the trigger follows its field back').toBeEnabled();
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
                /** @type {any} */ (window).__parseSent = true;
                const json = () => new Promise((_, reject) => init?.signal?.addEventListener('abort',
                    () => reject(new DOMException('The operation was aborted.', 'AbortError'))));
                return Promise.resolve({ ok: true, status: 200, json });
            };
        });
        await page.goto('/operations.html');
        await choosePdf(page);
        await page.locator('#rosterParseBtn').click();
        await expect(page.locator('#rosterParseBtn')).toHaveText('Reading…');
        // The read's own bound starts as the request goes, after the file is read and a token fetched —
        // not at "Reading…". Moved before then, the clock left the bound to run in real time, and on a
        // busy machine the line never came (13 Nov 2026).
        await expect.poll(() => page.evaluate(() => /** @type {any} */ (window).__parseSent === true),
            { message: 'the read was never sent' }).toBe(true);
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

// ── DOCUMENT LINKS (rotateDocumentLinks, 12 Nov 2026 — ARCHITECTURE.md EXC-007) ─────────────────
// The card's whole safety is its ORDER: a check that changes nothing, then a confirm, then the run.
// These drive the real page: the request bodies are recorded as they leave, so a card that sent
// `rotate: true` on the check, or ran without the confirm, fails here rather than on the live files.

/** A server report; `over` replaces fields. @param {Record<string, any>} [over] */
const linksReport = (over = {}) => ({
    rotate: false, files: 4, linked: 3, unlinkedWithKey: 1, unlinkedWithoutKey: 0, held: 0,
    recordsMissingFile: 0, recordsUnreadable: 0, recordsWithoutLink: 0,
    rotated: 0, cleared: 0, changedDuringRun: 0, failed: [], ...over,
});

/**
 * Stub rotateDocumentLinks: a preview always answers `preview`; each run takes the next of `runs`
 * ({ status, body } — a string body is sent as it is). Returns the bodies the page sent, in order.
 * @param {import('@playwright/test').Page} page
 * @param {{ status: number, body: any }[]} runs
 * @param {any} [preview]  the preview's report (default: the ordinary one)
 */
async function stubLinkRotation(page, runs, preview = linksReport()) {
    /** @type {any[]} */
    const sent = [];
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST' };
    await page.route(/getAccountSetupGaps|getSignInStats/, route => route.abort('failed'));   // hermetic
    await page.route('**/rotateDocumentLinks', route => {
        if (route.request().method() !== 'POST') return route.fulfill({ status: 204, headers: cors });
        const body = route.request().postDataJSON();
        sent.push(body);
        const answer = body.rotate === true ? runs.shift() ?? { status: 500, body: 'no run planned' } : { status: 200, body: preview };
        return route.fulfill({ status: answer.status, headers: cors,
            contentType: typeof answer.body === 'string' ? 'text/html' : 'application/json',
            body: typeof answer.body === 'string' ? answer.body : JSON.stringify(answer.body) });
    });
    return sent;
}

test('operations document links: Check changes nothing, Replace asks first, and a run says what it did', async ({ page }) => {
    await page.addInitScript(() => { /** @type {any} */ (window).__E2E = { authUser: true, docs: [] }; });
    const sent = await stubLinkRotation(page, [{ status: 200, body: linksReport({ rotate: true, rotated: 3, cleared: 1 }) }]);
    await seedSession(page, 'G. Miller');
    await page.goto('/operations.html');
    const body = page.locator('#docLinksBody');
    const check = page.locator('#docLinksCheckBtn');
    const replace = page.locator('#docLinksReplaceBtn');
    const result = page.locator('#docLinksResult');
    await page.locator('#docLinksChevron').click();
    await expect(body).toHaveClass(/\bopen\b/);
    await expect(check).toBeVisible();
    await expect(replace, 'nothing to replace until a check has said what there is').toBeHidden();

    await check.click();
    await expect(result).toContainText('3 files are in use. Each gets a new link');
    await expect(result).toContainText('1 older file is no longer used by the app.');
    await expect(result).toContainText('Nothing has changed yet.');
    expect(sent, 'the check asked for a preview').toEqual([{ rotate: false }]);
    await expect(replace).toBeVisible();

    // Cancelling the question sends nothing.
    await replace.click();
    const dialog = page.locator('.lb-overlay.open');
    await expect(dialog.locator('.dialog-message')).toHaveText('Old copies of the links to 4 files stop working straight away. Staff won’t notice anything in the app.');
    await dialog.locator('.dialog-btn-cancel').click();
    await expect(page.locator('.lb-overlay.open')).toHaveCount(0);
    expect(sent, 'a cancelled confirm ran nothing').toEqual([{ rotate: false }]);
    await expect(result).toContainText('Nothing has changed yet.');

    await replace.click();
    await page.locator('.lb-overlay.open .dialog-btn-confirm').click();
    await expect(result).toContainText('Done. 3 files have new links, so old copies of their links no longer work.');
    await expect(result).toContainText('1 unused file had its link switched off.');
    await expect(result).toHaveClass(/huddle-feedback--ok/);
    expect(sent, 'only the confirmed press asked for a run').toEqual([{ rotate: false }, { rotate: true }]);
    await expect(replace, 'a clean run puts the button away').toBeHidden();
});

// A document whose stored link no longer opens its file (functions/doc-link-rotation.js): the check
// says what that means for staff and that Replace mends it — and Replace is there to press.
test('operations document links: a document whose link no longer opens its file is named, and Replace is offered', async ({ page }) => {
    await page.addInitScript(() => { /** @type {any} */ (window).__E2E = { authUser: true, docs: [] }; });
    const sent = await stubLinkRotation(page, [], linksReport({ files: 3, linked: 3, unlinkedWithKey: 0, recordsDeadLink: 1 }));
    await seedSession(page, 'G. Miller');
    await page.goto('/operations.html');
    await page.locator('#docLinksChevron').click();
    await page.locator('#docLinksCheckBtn').click();
    const result = page.locator('#docLinksResult');
    await expect(result).toContainText('1 document’s link no longer opens its file. Staff still open the document — the app opens it '
        + 'with a fresh link of its own, and uses this one only if that fails. Replacing the links fixes it.');
    await expect(page.locator('#docLinksReplaceBtn'), 'Replace is what mends it').toBeVisible();
    expect(sent, 'a check asks for a preview, and nothing else').toEqual([{ rotate: false }]);
});

test('operations document links: a run that left a file, or whose answer is lost, keeps Replace and says so', async ({ page }) => {
    await page.addInitScript(() => { /** @type {any} */ (window).__E2E = { authUser: true, docs: [] }; });
    const sent = await stubLinkRotation(page, [
        { status: 200, body: linksReport({ rotate: true, rotated: 3, failed: [{ path: 'huddles/2026-11-12.pdf', step: 'contract' }] }) },
        { status: 503, body: '<html><body>Service Unavailable</body></html>' },          // the platform's
        { status: 503, body: { error: 'Couldn’t read the documents, so nothing was changed', changed: false } },   // the endpoint's
    ]);
    await seedSession(page, 'G. Miller');
    await page.goto('/operations.html');
    await page.locator('#docLinksChevron').click();
    await page.locator('#docLinksCheckBtn').click();
    const replace = page.locator('#docLinksReplaceBtn');
    const result = page.locator('#docLinksResult');
    await expect(replace).toBeVisible();

    await replace.click();
    await page.locator('.lb-overlay.open .dialog-btn-confirm').click();
    await expect(result).toContainText('Done. 3 files have new links');
    await expect(result).toContainText('1 file couldn’t be changed, and its old link still works.');
    await expect(result).toHaveClass(/huddle-feedback--err/);
    await expect(replace, 'a file left unchanged keeps the retry one press away').toBeVisible();

    await replace.click();
    await page.locator('.lb-overlay.open .dialog-btn-confirm').click();
    await expect(result).toHaveText('It isn’t known whether it finished. Press Replace the links again to make sure — running it twice is safe.');
    await expect(result).toHaveClass(/huddle-feedback--err/);
    await expect(replace, 'one press away from making sure').toBeVisible();
    await expect(replace).toBeEnabled();

    await replace.click();
    await page.locator('.lb-overlay.open .dialog-btn-confirm').click();
    await expect(result).toHaveText('Couldn’t read the documents, so nothing was changed. Try again in a minute.');
    expect(sent).toEqual([{ rotate: false }, { rotate: true }, { rotate: true }, { rotate: true }]);

    // No sign-in token, so no request: nothing was sent, which is known — never "isn’t known".
    await page.evaluate(() => { /** @type {any} */ (window).__E2E.authUser = false; });
    await replace.click();
    await page.locator('.lb-overlay.open .dialog-btn-confirm').click();
    await expect(result).toHaveText('Couldn’t replace the links: the request was never sent, so nothing was changed. Check your connection and try again.');
    await expect(result).toHaveClass(/huddle-feedback--err/);
    expect(sent, 'nothing left the page').toEqual([{ rotate: false }, { rotate: true }, { rotate: true }, { rotate: true }]);
});

// v25.92: AN UPDATE WAITS FOR THE ANSWER. A run can take minutes, and its report is the only record of
// what it did — a check made after a run reads exactly like one made before it — so a check or a run
// still out is busy, asked here the way the worker asks. And the page stops being busy once the answer
// is on screen: a count that never came back down would hold every later update for good.
test('operations document links: a check or a run still waiting for its answer holds an update', async ({ page }) => {
    await page.addInitScript(() => { /** @type {any} */ (window).__E2E = { authUser: true, docs: [] }; });
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST' };
    await page.route(/getAccountSetupGaps|getSignInStats/, route => route.abort('failed'));   // hermetic
    /** Each answer the server has not yet given, released by the test. @type {Array<() => void>} */
    const held = [];
    await page.route('**/rotateDocumentLinks', async route => {
        if (route.request().method() !== 'POST') return route.fulfill({ status: 204, headers: cors });
        const run = route.request().postDataJSON().rotate === true;
        await new Promise(release => held.push(() => release(undefined)));
        return route.fulfill({ status: 200, headers: cors, contentType: 'application/json',
            body: JSON.stringify(run ? linksReport({ rotate: true, rotated: 3, cleared: 1 }) : linksReport()) });
    });
    const busy = () => page.evaluate(() => new Promise(resolve => {
        const ch = new MessageChannel();
        ch.port1.onmessage = (e) => resolve(e.data?.busy);
        navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: { type: 'myb-busy?' }, ports: [ch.port2] }));
    }));
    await seedSession(page, 'G. Miller');
    await page.goto('/operations.html');
    await page.locator('#docLinksChevron').click();
    const result = page.locator('#docLinksResult');
    expect(await busy(), 'nothing has been asked yet').toBe(false);

    await page.locator('#docLinksCheckBtn').click();
    await expect(result).toHaveText('Checking the links');
    await expect.poll(() => held.length).toBe(1);
    expect(await busy(), 'a check waiting for its answer — a reload now loses what it found').toBe(true);
    held.shift()?.();
    await expect(result).toContainText('Nothing has changed yet.');
    expect(await busy(), 'the check has answered').toBe(false);

    await page.locator('#docLinksReplaceBtn').click();
    await page.locator('.lb-overlay.open .dialog-btn-confirm').click();
    await expect(result).toHaveText('Replacing the links — this can take a minute');
    await expect.poll(() => held.length).toBe(1);
    expect(await busy(), 'a run waiting for its answer — a reload now loses its report').toBe(true);
    held.shift()?.();
    await expect(result).toContainText('Done. 3 files have new links');
    expect(await busy(), 'the report is on screen, so an update need wait no longer').toBe(false);
});

// ── ANNUAL LEAVE SHEET (14 Nov 2026) ────────────────────────────────────────────────────────────────
// Phase 1 of the leave uploader (docs/AL_UPLOADER_PLAN.md): a sealed leave file in, each member's
// records read whole, every difference on screen, and NOTHING written. The file and its two people
// come from al-sheet-fixture.js — taken from the roster by rule, never typed here by name. The words
// are al-leave-words.js's and are asserted from it; what only a browser shows is the WIRING: the right
// sentence on the right day, each member read once and by name, a cached read stopping the check, a hand
// edit refused before anything is read, and an update waiting while the answer is on screen.
/**
 * Operations, signed in as the admin, with the Annual leave sheet card open and these override records
 * served to its reads.
 * @param {import('@playwright/test').Page} page @param {any[]} records @param {Record<string, any>} [more]
 */
async function openAlSheet(page, records, more = {}) {
    await page.addInitScript(([rows, extra]) => {
        const w = /** @type {any} */ (window);
        w.__E2E = { ...(w.__E2E || {}), authUser: true, docs: [], docsByQuery: { overrides: rows }, ...extra };
    }, [records, more]);
    await page.route(/getAccountSetupGaps|getSignInStats/, route => route.abort('failed'));   // hermetic
    await seedSession(page, 'G. Miller');
    await page.goto('/operations.html');
    await page.locator('#alSheetChevron').click();
    await expect(page.locator('#alSheetCheckBtn')).toBeVisible();
}
/** @param {import('@playwright/test').Page} page @param {string} text */
const chooseLeaveFile = (page, text) => page.locator('#alSheetFileInput')
    .setInputFiles({ name: 'leave-2026.leave.json', mimeType: 'application/json', buffer: Buffer.from(text) });
/** Every member the card asked for by name, in order. @param {import('@playwright/test').Page} page */
const memberReads = page => page.evaluate(() => (/** @type {any} */ (window).__E2E?.whereCalls || [])
    .filter((/** @type {any[]} */ w) => w[0] === 'memberName').map((/** @type {any[]} */ w) => w[2]));
/** What the page answers the worker's "busy?" when a notification is tapped (sw-register.js →
 *  answerNotificationTaps): while true the tap does not take the page away. The update reload's own hold
 *  is a different question, `alSheetCardBusy` below. */
const tapIsHeld = (/** @type {import('@playwright/test').Page} */ page) => page.evaluate(() => new Promise(resolve => {
    const ch = new MessageChannel();
    ch.port1.onmessage = (e) => resolve(e.data?.busy);
    navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: { type: 'myb-busy?' }, ports: [ch.port2] }));
}));

test('operations annual leave sheet: each person is checked against their own records, day by day, and nothing is saved', async ({ page }) => {
    const errors = collectFatalErrors(page);
    const fx = await alSheetFixture();
    await openAlSheet(page, fx.records);
    const check = page.locator('#alSheetCheckBtn');
    await expect(check, 'nothing chosen yet').toBeDisabled();
    await chooseLeaveFile(page, fx.text);
    await expect(page.locator('#alSheetFileName')).toHaveText('leave-2026.leave.json');
    await check.click();

    await expect(page.locator('#alSheetFeedback')).toHaveText(checkedWords(2));
    const result = page.locator('#alSheetResult');
    await expect(result).toBeVisible();
    expect((await memberReads(page)).sort(), 'each person on the sheet is read once, whole, by name — and nobody else')
        .toEqual([fx.A.name, fx.B.name].sort());

    await expect(result.locator('.al-sheet-age')).toContainText('(2 days ago)');
    await expect(result.locator('.al-sheet-warn'), 'a fresh copy saved by the clerks carries no warning').toHaveCount(0);
    await expect(result.locator('.al-sheet-overall')).toHaveText(overallWords(1, 2));
    await expect(result.locator('.al-sheet-totals li')).toHaveText(totalsEntries({ 'not-in-app': 1, 'rest-day': 1, 'app-only': 1 }).map(e => e.text));
    // …and each line carries its kind, which is what colours its bullet like the chips below it.
    await expect(result.locator('.al-sheet-totals li')).toHaveClass(
        totalsEntries({ 'not-in-app': 1, 'rest-day': 1, 'app-only': 1 }).map(e => new RegExp(`al-sheet-total--${e.key}`)));
    await expect(result.locator('.al-sheet-heading'))
        .toHaveText([CARD_WORDS.needsALook, CARD_WORDS.agree, CARD_WORDS.notCompared, CARD_WORDS.absent]);
    await expect(result.locator('.al-sheet-list li')).toHaveText([notComparedWords({ name: 'Z. Example', reason: 'not-in-app' })]);

    // The person who needs a look: their closed row says why, and their days say what each side has.
    const people = result.locator('.al-sheet-people');
    const a = people.nth(0).locator('.al-sheet-person');
    await expect(a).toHaveCount(1);
    await expect(a.locator('.al-sheet-name')).toHaveText(fx.A.name);
    await expect(a.locator('.al-sheet-chip')).toHaveText(chipsFor({ 'not-in-app': 1, 'rest-day': 1, 'app-only': 1 }).map(c => c.text));
    await a.locator('.al-sheet-person-head').click();
    /** @param {string} d */
    const day = d => a.locator('.al-sheet-day', { hasText: dayLabel(d) });
    await expect(day(fx.dates.missing)).toHaveClass(/al-sheet-day--not-in-app/);
    const missingPattern = getBaseShift(fx.A, parseISODate(fx.dates.missing));
    await expect(day(fx.dates.missing).locator('.al-sheet-app')).toHaveText(appWords({ state: 'not-in-app', pattern: missingPattern,
        drawn: { shift: missingPattern, rdwTime: '', fromPattern: true, type: null } }, fx.year));
    await expect(day(fx.dates.restDay)).toHaveClass(/al-sheet-day--rest-day/);
    await expect(day(fx.dates.appOnly)).toHaveClass(/al-sheet-day--app-only/);
    await expect(day(fx.dates.appOnly).locator('.al-sheet-app')).toHaveText(appOnlyWords(fx.year));
    // The day that agrees is folded away, not lost.
    const more = a.locator('.al-sheet-more');
    await expect(more.locator('summary')).toHaveText(moreDaysWords(1));
    await expect(day(fx.dates.match)).toBeHidden();
    await more.locator('summary').click();
    await expect(day(fx.dates.match)).toHaveClass(/al-sheet-day--match/);

    // The person who agrees has no chips at all, and waits in a closed fold that says how many agree:
    // the people who need a look are the work, and the agreeing ones come after only when asked for.
    const agreeing = result.locator('.al-sheet-group');
    await expect(agreeing).not.toHaveAttribute('open');
    await expect(agreeing.locator('.al-sheet-count')).toHaveText('1');
    const b = people.nth(1).locator('.al-sheet-person');
    await expect(b.locator('.al-sheet-name')).toHaveText(fx.B.name);
    await expect(b, 'folded away until asked for').toBeHidden();
    await agreeing.locator('.al-sheet-group-head').click();
    await expect(b).toBeVisible();
    await expect(b.locator('.al-sheet-chip')).toHaveCount(0);

    // The Save is offered, so the closing line says what pressing it does (Phase 2b).
    await expect(result.locator('.al-sheet-note').last()).toHaveText(SAVE_WORDS.saveable);
    const writes = await page.evaluate(() => {
        const e = /** @type {any} */ (window).__E2E || {};
        return [...(e.setWrites || []), ...(e.batchWrites || []), ...(e.deletedPaths || [])];
    });
    expect(writes, 'a check writes nothing').toEqual([]);

    // Clear takes it off the screen, and leaves nothing chosen.
    await page.locator('#alSheetClearBtn').click();
    await expect(result).toBeHidden();
    await expect(page.locator('#alSheetClearBtn')).toBeHidden();
    await expect(page.locator('#alSheetFileName')).toHaveText('');
    await expect(check).toBeDisabled();
    expect(errors).toEqual([]);
});

test('operations annual leave sheet: a hand-edited file is refused by its seal before anything is read', async ({ page }) => {
    const fx = await alSheetFixture();
    await openAlSheet(page, fx.records);
    const edited = fx.text.replace(`"date":"${fx.dates.missing}"`, `"date":"${fx.dates.appOnly}"`);
    expect(edited, 'premise: the edit applied').not.toBe(fx.text);
    // The most recent way in wins: a file chosen and then text pasted checks the TEXT, and lets the file go.
    await chooseLeaveFile(page, fx.text);
    await expect(page.locator('#alSheetFileName')).toHaveText('leave-2026.leave.json');
    await page.locator('#alSheetPaste').fill(edited);
    await expect(page.locator('#alSheetFileName')).toHaveText('');
    await page.locator('#alSheetCheckBtn').click();
    await expect(page.locator('#alSheetFeedback')).toHaveText(describeRefusal({ code: 'changed-since-made' }));
    await expect(page.locator('#alSheetFeedback')).toHaveClass(/huddle-feedback--err/);
    await expect(page.locator('#alSheetResult')).toBeHidden();
    expect(await memberReads(page), 'nobody’s records were read for a file that is not the one made').toEqual([]);

    await page.locator('#alSheetPaste').fill('not a leave file');
    await page.locator('#alSheetCheckBtn').click();
    await expect(page.locator('#alSheetFeedback')).toHaveText(describeRefusal({ code: 'not-json' }));

    // …and the other way round: a file chosen after pasting empties the box, and the FILE is checked.
    await chooseLeaveFile(page, fx.text);
    await expect(page.locator('#alSheetPaste')).toHaveValue('');
    await page.locator('#alSheetCheckBtn').click();
    await expect(page.locator('#alSheetFeedback')).toHaveText(checkedWords(2));
});

test('operations annual leave sheet: a read answered from this device’s cache stops the whole check', async ({ page }) => {
    const fx = await alSheetFixture();
    await openAlSheet(page, fx.records);
    await chooseLeaveFile(page, fx.text);
    await page.evaluate(() => { /** @type {any} */ (window).__E2E.docsFromCache = true; });
    await page.locator('#alSheetCheckBtn').click();
    await expect(page.locator('#alSheetFeedback')).toHaveText(CARD_WORDS.offline);
    await expect(page.locator('#alSheetResult'), 'no comparison drawn on a partial copy').toBeHidden();
    await expect(page.locator('#alSheetCheckBtn'), 'the same file can be checked again').toBeEnabled();

    await page.evaluate(() => { /** @type {any} */ (window).__E2E.docsFromCache = false; });
    await page.locator('#alSheetCheckBtn').click();
    await expect(page.locator('#alSheetFeedback')).toHaveText(checkedWords(2));
});

/** The card's own hold, read from the module the page loaded — what the update reload waits on. */
const alSheetCardBusy = (/** @type {import('@playwright/test').Page} */ page) =>
    page.evaluate(async () => (await import('/operations-al-sheet.js')).alSheetBusy());

test('operations annual leave sheet: an update waits while a check runs or its answer is on screen — a notification tap does not', async ({ page }) => {
    // The update reload asks _opsBusy OR the card (operations-app.js); a tap asks _opsBusy and the card's
    // UNSAVED answers only, because it is the reader's own choice and a check saves nothing ("unsaved
    // changes or a save still on its way" was untrue, review 14 Nov 2026). page-contract-parity.test.mjs
    // pins the wiring itself.
    const fx = await alSheetFixture();
    await openAlSheet(page, fx.records);
    expect(await alSheetCardBusy(page), 'nothing checked yet').toBe(false);
    await chooseLeaveFile(page, fx.text);
    await page.evaluate(() => { /** @type {any} */ (window).__E2E.docsHeld = true; });
    await page.locator('#alSheetCheckBtn').click();
    await expect(page.locator('#alSheetFeedback')).toHaveText(CARD_WORDS.checking);
    expect(await alSheetCardBusy(page), 'reading the records — a reload now loses the check').toBe(true);
    expect(await tapIsHeld(page), 'a tap is not held by a check that only reads').toBe(false);
    await page.evaluate(() => { /** @type {any} */ (window).__E2E.docsHeld = false; });
    await expect(page.locator('#alSheetResult')).toBeVisible();
    expect(await alSheetCardBusy(page), 'forty people’s differences on screen — a reload takes them away unsaid').toBe(true);
    expect(await tapIsHeld(page), 'nor by its answer on screen').toBe(false);
    await page.locator('#alSheetClearBtn').click();
    expect(await alSheetCardBusy(page), 'cleared, so an update need wait no longer').toBe(false);
});

test('operations annual leave sheet: the SAME file chosen again is read again', async ({ page }, testInfo) => {
    // An input still holding a file fires no `change` when that file is chosen again, so a corrected
    // copy saved over the old one was never read (review, 14 Nov 2026). Chosen BY PATH, as a person
    // does — a buffer fires `change` every time and hides the fault. Written outside the repository.
    const fx = await alSheetFixture();
    await openAlSheet(page, fx.records);
    const path = join(tmpdir(), `al-sheet-e2e-${process.pid}-${testInfo.workerIndex}-${testInfo.repeatEachIndex}.json`);
    try {
        writeFileSync(path, fx.text);
        await page.locator('#alSheetFileInput').setInputFiles(path);
        await page.locator('#alSheetCheckBtn').click();
        await expect(page.locator('#alSheetFeedback')).toHaveText(checkedWords(2));
        writeFileSync(path, fx.text.replace(`"date":"${fx.dates.missing}"`, `"date":"${fx.dates.appOnly}"`));
        await page.locator('#alSheetFileInput').setInputFiles(path);
        await expect(page.locator('#alSheetResult'), 'a new choice takes the old answer off the screen').toBeHidden();
        await page.locator('#alSheetCheckBtn').click();
        await expect(page.locator('#alSheetFeedback'), 'the edited copy is the one checked').toHaveText(describeRefusal({ code: 'changed-since-made' }));
    } finally {
        rmSync(path, { force: true });
    }
});

test('operations annual leave sheet: a new input takes the old answer away, and two checks draw one answer', async ({ page }) => {
    const fx = await alSheetFixture();
    const old = await alSheetFixture({ savedDaysAgo: LEAVE_FILE_MAX_AGE_DAYS + 9 });
    await openAlSheet(page, fx.records);
    const result = page.locator('#alSheetResult');
    await chooseLeaveFile(page, fx.text);
    await page.locator('#alSheetCheckBtn').click();
    await expect(result).toBeVisible();
    // Checked again: one answer, not two stacked.
    await page.locator('#alSheetCheckBtn').click();
    await expect(page.locator('#alSheetFeedback')).toHaveText(checkedWords(2));
    await expect(result.locator('.al-sheet-summary')).toHaveCount(1);
    // A different file: the first file's answer and status go — it read as the new file's (review, 14 Nov 2026).
    await chooseLeaveFile(page, old.text);
    await expect(result).toBeHidden();
    await expect(page.locator('#alSheetFeedback')).toHaveText('');
    await expect(page.locator('#alSheetClearBtn')).toBeHidden();
    await page.locator('#alSheetCheckBtn').click();
    await expect(result.locator('.al-sheet-warn')).toHaveText(refusalWords('too-old', { maxAge: LEAVE_FILE_MAX_AGE_DAYS }));
    // Typing in the paste box does the same.
    await page.locator('#alSheetPaste').fill('x');
    await expect(result).toBeHidden();
    await expect(page.locator('#alSheetFeedback')).toHaveText('');
    // And a check still reading when a new file is chosen draws NOTHING when its reads land: it was
    // the old file's, and the label already names the new one.
    await page.locator('#alSheetPaste').fill('');
    await chooseLeaveFile(page, fx.text);
    await page.evaluate(() => { /** @type {any} */ (window).__E2E.docsHeld = true; });
    await page.locator('#alSheetCheckBtn').click();
    await expect(page.locator('#alSheetFeedback')).toHaveText(CARD_WORDS.checking);
    await page.locator('#alSheetFileInput').setInputFiles({ name: 'second.leave.json', mimeType: 'application/json', buffer: Buffer.from(old.text) });
    await page.evaluate(() => { /** @type {any} */ (window).__E2E.docsHeld = false; });
    await expect(page.locator('#alSheetCheckBtn'), 'the stale check has settled').toBeEnabled();
    await expect(result, 'the stale check drew nothing').toBeHidden();
    await expect(page.locator('#alSheetFeedback')).toHaveText('');
    await expect(page.locator('#alSheetFileName')).toHaveText('second.leave.json');
});

test('operations annual leave sheet: a slow read that lands after a newer input is dropped', async ({ page }) => {
    // A cloud-backed file on a phone can take seconds. The newest input must win however late the
    // older one's read lands (review, 14 Nov 2026).
    const fx = await alSheetFixture();
    await openAlSheet(page, fx.records);
    await page.evaluate(() => {
        const read = File.prototype.text;
        File.prototype.text = function () {
            return this.name === 'slow.leave.json' ? new Promise(r => setTimeout(() => r(read.call(this)), 600)) : read.call(this);
        };
    });
    const choose = (/** @type {string} */ name, /** @type {string} */ text) => page.locator('#alSheetFileInput')
        .setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(text) });
    // A slow file, then text pasted while it is read: the TEXT is what is checked.
    await choose('slow.leave.json', fx.text);
    await page.locator('#alSheetPaste').fill('not a leave file');
    await expect(page.locator('#alSheetFileName')).toHaveText('');
    await page.waitForTimeout(900);
    await expect(page.locator('#alSheetFileName'), 'the late read does not bring the file back').toHaveText('');
    await page.locator('#alSheetCheckBtn').click();
    await expect(page.locator('#alSheetFeedback')).toHaveText(describeRefusal({ code: 'not-json' }));
    // A slow bad file, then a fast good one: the GOOD one is checked, under its own name.
    await page.locator('#alSheetPaste').fill('');
    await choose('slow.leave.json', 'not a leave file');
    await choose('leave-2026.leave.json', fx.text);
    await page.waitForTimeout(900);
    await expect(page.locator('#alSheetFileName')).toHaveText('leave-2026.leave.json');
    await page.locator('#alSheetCheckBtn').click();
    await expect(page.locator('#alSheetFeedback')).toHaveText(checkedWords(2));
});

test('operations annual leave sheet: a file too large is refused before it is read, and Clear hands focus back', async ({ page }) => {
    const fx = await alSheetFixture();
    await openAlSheet(page, fx.records);
    await page.evaluate(() => {
        const w = /** @type {any} */ (window);
        const read = File.prototype.text;
        w.__reads = 0;
        File.prototype.text = function () { w.__reads++; return read.call(this); };
    });
    await page.locator('#alSheetFileInput').setInputFiles({ name: 'huge.json', mimeType: 'application/json',
        buffer: Buffer.alloc(LEAVE_FILE_MAX_BYTES + 1, 0x20) });
    await expect(page.locator('#alSheetFeedback')).toHaveText(describeRefusal({ code: 'too-large' }));
    await expect(page.locator('#alSheetCheckBtn')).toBeDisabled();
    expect(await page.evaluate(() => /** @type {any} */ (window).__reads), 'never loaded into memory').toBe(0);
    // Clear hides itself; focus goes to the file control, not to the page (review, 14 Nov 2026).
    await chooseLeaveFile(page, fx.text);
    await page.locator('#alSheetCheckBtn').click();
    await page.locator('#alSheetClearBtn').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#alSheetClearBtn')).toBeHidden();
    await expect(page.locator('#alSheetFileInput')).toBeFocused();
});

test('operations annual leave sheet: a failed read, and a fault, each say so — never "Checking…" for good', async ({ page }) => {
    const fx = await alSheetFixture();
    await openAlSheet(page, fx.records);
    await chooseLeaveFile(page, fx.text);
    // A read that fails outright (not from the cache).
    await page.evaluate(() => { const e = /** @type {any} */ (window).__E2E; e.docsHeld = true; e.heldFailWith = 'e2e: read failed'; });
    await page.locator('#alSheetCheckBtn').click();
    await expect(page.locator('#alSheetFeedback')).toHaveText(CARD_WORDS.checking);
    await page.evaluate(() => { /** @type {any} */ (window).__E2E.docsHeld = false; });
    await expect(page.locator('#alSheetFeedback')).toHaveText(CARD_WORDS.readFailed);
    await expect(page.locator('#alSheetCheckBtn')).toBeEnabled();
    // A fault inside the check — nothing there is meant to throw.
    await page.evaluate(async () => {
        const e = /** @type {any} */ (window).__E2E; e.heldFailWith = undefined;
        const { teamMembers } = await import('/roster-data.js');
        /** @type {any} */ (teamMembers).find = () => { throw new TypeError('e2e fault'); };
    });
    await page.locator('#alSheetCheckBtn').click();
    await expect(page.locator('#alSheetFeedback')).toHaveText(CARD_WORDS.failed);
    await expect(page.locator('#alSheetResult')).toBeHidden();
    await expect(page.locator('#alSheetCheckBtn')).toBeEnabled();
});

test('operations annual leave sheet: a member who has left since the file was made is not read, and is said to have left', async ({ page }) => {
    const fx = await alSheetFixture({ withLeaver: true });
    const L = /** @type {any} */ (fx.L);
    await openAlSheet(page, fx.records);
    await chooseLeaveFile(page, fx.text);
    await page.locator('#alSheetCheckBtn').click();
    await expect(page.locator('#alSheetFeedback')).toHaveText(checkedWords(2));
    expect(await memberReads(page)).not.toContain(L.name);
    await expect(page.locator('#alSheetResult .al-sheet-list li')).toContainText([notComparedWords({ name: L.name, reason: 'leaver' })]);
});

test('operations annual leave sheet: this device’s own unsent save is read as its own copy', async ({ page }) => {
    // The SDK hands an unsent record over with no server time; read as it came, the older shift on
    // the same day would win it (overrideFromSnapshot). The stub's __pendingWrite is that shape.
    const fx = await alSheetFixture();
    const records = fx.records.map(r => (r.memberName === fx.A.name && r.date === fx.dates.match
        ? { ...r, createdAt: 1_780_000_000_000, __pendingWrite: true } : r));
    records.push({ id: `${fx.A.name}|${fx.dates.match}|shift`, memberName: fx.A.name, date: fx.dates.match, type: 'shift',
        value: '10:00-18:00', note: '', source: 'manual', createdAt: 1_770_000_000_000 });
    await openAlSheet(page, records);
    await chooseLeaveFile(page, fx.text);
    await page.locator('#alSheetCheckBtn').click();
    const a = page.locator('.al-sheet-person').filter({ has: page.locator('.al-sheet-name', { hasText: fx.A.name }) });
    await a.locator('.al-sheet-person-head').click();
    await a.locator('.al-sheet-more > summary').click();
    await expect(a.locator('.al-sheet-day', { hasText: dayLabel(fx.dates.match) })).toHaveClass(/al-sheet-day--match/);
});

test('operations annual leave sheet: leave after the sheet ends is listed, and a file with no save date says so', async ({ page }) => {
    const fx = await alSheetFixture({ savedDaysAgo: null });
    // A day B works, after the sheet's last date (2 Jan 2027) — found from the pattern, as the fixture's are.
    let after = '2027-01-04';
    while (!/^\d\d:\d\d-\d\d:\d\d$/.test(getBaseShift(fx.B, parseISODate(after)))) {
        after = new Date(Date.parse(`${after}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    }
    expect(after.startsWith('2027-01-'), `the case needs a January working day, found ${after}`).toBe(true);
    await openAlSheet(page, [...fx.records, { id: `${fx.B.name}|${after}`, memberName: fx.B.name, date: after, type: 'annual_leave',
        value: 'AL', note: '', source: 'manual', createdAt: 1_770_000_000_000, leaveYear: fx.year }]);
    await chooseLeaveFile(page, fx.text);
    await page.locator('#alSheetCheckBtn').click();
    const result = page.locator('#alSheetResult');
    // A copy of unknown age cannot be saved, and says so once, in the Save's refusal (Phase 2b).
    await expect(result.locator('.al-sheet-warn')).toHaveText(refusalWords('age-unknown', { maxAge: LEAVE_FILE_MAX_AGE_DAYS }));
    await expect(result.locator('#alSheetSaveBtn, .al-sheet-confirm, .al-sheet-answer'), 'a check only').toHaveCount(0);
    const b = result.locator('.al-sheet-person').filter({ has: page.locator('.al-sheet-name', { hasText: fx.B.name }) });
    await expect(b.locator('.al-sheet-chip--beyond')).toHaveText(chipsFor({ beyond: 1 })[0].text);
    await b.locator('.al-sheet-person-head').click();
    await expect(b.locator('.al-sheet-subhead')).toHaveText(beyondHeadWords(fx.year));
    await expect(b.locator('.al-sheet-day--beyond')).toContainText(dayLabel(after));
});

test('operations annual leave sheet: an old copy is flagged, and an allowance that differs is a reason to look on its own', async ({ page }) => {
    const fx = await alSheetFixture({ savedDaysAgo: LEAVE_FILE_MAX_AGE_DAYS + 6, bAllowanceOff: 1 });
    await openAlSheet(page, fx.records);
    await chooseLeaveFile(page, fx.text);
    await page.locator('#alSheetCheckBtn').click();
    const result = page.locator('#alSheetResult');
    // Past the age limit it cannot be saved (decision 4), and the refusal names the age (Phase 2b).
    await expect(result.locator('.al-sheet-warn')).toHaveText(refusalWords('too-old', { maxAge: LEAVE_FILE_MAX_AGE_DAYS }));
    await expect(result.locator('#alSheetSaveBtn, .al-sheet-confirm, .al-sheet-answer'), 'a check only').toHaveCount(0);
    await expect(result.locator('.al-sheet-note').last()).toHaveText(CARD_WORDS.checkOnly);
    await expect(result.locator('.al-sheet-overall')).toHaveText(overallWords(2, 2));
    await expect(result.locator('.al-sheet-totals li').first()).toHaveText(totalsEntries({}, 1)[0].text);
    await expect(result.locator('.al-sheet-heading'), 'nobody agrees now').not.toContainText([CARD_WORDS.agree]);
    // B's only difference is the allowance, and their closed row still says so.
    const b = result.locator('.al-sheet-person').filter({ has: page.locator('.al-sheet-name', { hasText: fx.B.name }) });
    await expect(b.locator('.al-sheet-chip')).toHaveText(chipsFor({}, true).map(c => c.text));
    await b.locator('.al-sheet-person-head').click();
    await expect(b.locator('.al-sheet-explain').first()).toContainText('The sheet allows');
});

// ── ANNUAL LEAVE SHEET: THE SAVE (Phase 2b, 14 Nov 2026) ────────────────────────────────────────────
// operations-al-save.js on the real page: a rest day answered in Admin's own words, a person confirmed,
// each day written at its fixed id as the Admin leave card writes it, the upload log written LAST from
// what the server then holds, the fresh check after it, and the Undo. The stub's writesLand mode lands
// every committed write where the next read sees it (fixtures.js), so the log and the Undo read back
// what the Save wrote: a test that counted calls could not tell a Save that wrote the right records
// from one that wrote anything. Names and dates come from al-sheet-fixture.js, by rule.

/** Every document a transaction or batch set in a collection, in order. @param {import('@playwright/test').Page} page @param {string} col */
const writtenTo = (page, col) => page.evaluate(c => (/** @type {any} */ (window).__E2E?.setWrites || [])
    .filter((/** @type {any} */ w) => w.path.startsWith(`${c}/`)), col);
/** @param {import('@playwright/test').Page} page @param {string} name */
const personRow = (page, name) => page.locator('#alSheetResult .al-sheet-person').filter({ has: page.locator('.al-sheet-name', { hasText: name }) });

/**
 * Check the fixture's file, open member A, answer their rest day and confirm them. Returns A's fold.
 * @param {import('@playwright/test').Page} page @param {any} fx @param {'swapped'|'free'} [answer]
 */
async function confirmA(page, fx, answer = 'swapped') {
    await chooseLeaveFile(page, fx.text);
    await page.locator('#alSheetCheckBtn').click();
    await expect(page.locator('#alSheetFeedback')).toHaveText(checkedWords(2));
    const a = personRow(page, fx.A.name);
    await a.locator('.al-sheet-person-head').click();
    const group = a.getByRole('radiogroup', { name: questionWords(fx.dates.restDay) });
    await group.getByRole('radio', { name: answer === 'swapped' ? SAVE_WORDS.swapped : SAVE_WORDS.free }).check();
    const add = answer === 'swapped' ? 2 : 1;
    await a.getByRole('checkbox', { name: confirmWords({ name: fx.A.name, add, swap: 0 }) }).check();
    await expect(page.locator('#alSheetSaveBtn')).toHaveText(saveButtonWords({ days: add, people: 1 }));
    return a;
}

test('operations annual leave sheet: the Save adds a confirmed person’s missing days and an answered rest day, records itself, and can be undone', async ({ page }) => {
    const errors = collectFatalErrors(page);
    const fx = await alSheetFixture();
    // Two earlier years' logs: the Save keeps last year's and this year's, and clears anything older
    // (al-leave-save.js → pruneUploadLogs). Neither can refuse this file: both copies are older than it.
    const thisYear = new Date().getFullYear();
    const oldLog = (/** @type {string} */ id, /** @type {number} */ year) => ({ id, year, fileDigest: `sha256:${'a'.repeat(64)}`,
        workbookSha256: 'a'.repeat(64), clerksLastSaved: '2000-01-03T09:00:00Z', lastSavedByClerk: true,
        savedAt: Date.now() - 400 * 86_400_000, savedBy: 'G. Miller', appVersion: 'e2e', inLine: [], added: [] });
    await openAlSheet(page, fx.records, { writesLand: true, docsByQuery: { overrides: fx.records,
        alUploads: [oldLog('log-too-old', thisYear - 2), oldLog('log-last-year', thisYear - 1)] } });
    await chooseLeaveFile(page, fx.text);
    await page.locator('#alSheetCheckBtn').click();
    const save = page.locator('#alSheetSaveBtn');
    await expect(save, 'nothing is saved for a person nobody confirmed').toHaveText(SAVE_WORDS.confirmFirst);
    await expect(save).toBeDisabled();
    const a = personRow(page, fx.A.name);
    await a.locator('.al-sheet-person-head').click();
    // The unanswered rest day is asked, never defaulted, and is not in the count until it is answered.
    const group = a.getByRole('radiogroup', { name: questionWords(fx.dates.restDay) });
    await expect(group.getByRole('radio', { checked: true })).toHaveCount(0);
    await expect(a.getByRole('checkbox', { name: confirmWords({ name: fx.A.name, add: 1, swap: 0 }) })).toBeVisible();
    await expect(a.locator('.al-sheet-save-person .al-sheet-explain').first()).toContainText('still to answer');
    expect(await tapIsHeld(page), 'nothing answered yet: a notification tap goes straight through').toBe(false);
    const confirmOne = a.getByRole('checkbox', { name: confirmWords({ name: fx.A.name, add: 1, swap: 0 }) });
    await confirmOne.check();
    expect(await tapIsHeld(page), 'a person confirmed and not saved: a tap asks first').toBe(true);
    await confirmOne.uncheck();
    expect(await tapIsHeld(page), 'unticked again, nothing is unsaved').toBe(false);
    await group.getByRole('radio', { name: SAVE_WORDS.swapped }).check();
    expect(await tapIsHeld(page), 'an answer not yet saved: a notification tap asks first').toBe(true);
    await a.getByRole('checkbox', { name: confirmWords({ name: fx.A.name, add: 2, swap: 0 }) }).check();
    await expect(a.locator('.al-sheet-after')).toContainText('After this Save — ');
    await expect(save).toHaveText(saveButtonWords({ days: 2, people: 1 }));

    await save.click();
    const feedback = page.locator('#alSheetFeedback');
    await expect(feedback).toContainText(receiptWords({ days: 2, people: 1, refused: new Map() })[0]);
    await expect(feedback).toContainText(SAVE_WORDS.recorded);
    await expect(feedback, 'a clean Save reads as one').toHaveClass(/huddle-feedback--ok/);
    await expect(feedback, 'focus goes to the receipt, so a reader at the foot of the list is taken to it').toBeFocused();
    const days = [fx.dates.missing, fx.dates.restDay];
    const writes = await writtenTo(page, 'overrides');
    expect(writes.map(w => w.path).sort()).toEqual(days.map(d => `overrides/${manualOverrideId(fx.A.name, d)}`).sort());
    const byDate = Object.fromEntries(writes.map(w => [w.data.date, w.data]));
    expect(byDate[fx.dates.missing]).toMatchObject({ memberName: fx.A.name, type: 'annual_leave', value: 'AL', note: '', source: 'manual', changedBy: 'G. Miller' });
    expect(byDate[fx.dates.missing].replacedType, 'a working day has nothing to put back').toBeUndefined();
    expect(byDate[fx.dates.restDay].replacedType, 'the answered swap is recorded, so the rest day costs a day').toBe('shift');
    const logs = await writtenTo(page, 'alUploads');
    expect(logs, 'one log, written once').toHaveLength(1);
    const added = days.map(d => `${fx.A.name}|${d}`).sort();
    expect(logs[0].data).toMatchObject({ year: fx.year, fileDigest: fx.file.digest, workbookSha256: fx.file.source.sha256,
        clerksLastSaved: fx.file.source.clerksLastSaved, lastSavedByClerk: true, savedBy: 'G. Miller', added });
    expect(logs[0].data.inLine, 'every sheet day the app now holds as leave, the days already right included').toEqual(
        [...added, `${fx.A.name}|${fx.dates.match}`, `${fx.B.name}|${fx.dates.bMatch}`].sort());
    // Every record carries the id of the Save's own log, minted before the first write, and the log says
    // so: that mark, not a date, is how its Undo knows a day is still the Save's (al-leave-plan.js).
    const logId = String(logs[0].path).slice('alUploads/'.length);
    expect(logs[0].data.writesMarked, 'the log says its Save marked every record').toBe(true);
    for (const w of writes) expect(w.data.uploadId, `${w.data.date} carries the id of the Save’s log`).toBe(logId);
    // The fresh check: A's two days are in line, nothing is left to save, and the Save can be undone.
    await expect(page.locator('#alSheetSaveBtn'), 'the same file again has nothing to save').toHaveCount(0);
    await expect(page.locator('.al-sheet-last')).toContainText('adding 2 days of leave');
    expect(await tapIsHeld(page), 'saved: nothing unsaved holds a tap').toBe(false);
    // Housekeeping, off the Save's path (it never holds the receipt — its own test is below).
    const pruned = () => page.evaluate(() => /** @type {any} */ (window).__E2E.batchDeletes || []);
    await expect.poll(pruned, 'a log from before last year is cleared').toContain('alUploads/log-too-old');
    expect(await pruned(), 'last year’s is kept: a January check of last year’s sheet still needs it').not.toContain('alUploads/log-last-year');

    // Undo asks first, and a Cancel removes nothing.
    await page.locator('.al-sheet-undo').click();
    await expect(page.locator('.lb-overlay.open .dialog-message')).toHaveText(undoConfirmWords(2));
    await page.locator('.lb-overlay.open .dialog-btn-cancel').click();
    await expect(page.locator('.lb-overlay.open')).toHaveCount(0);
    expect(await page.evaluate(() => /** @type {any} */ (window).__E2E.deletedPaths || []), 'a cancelled Undo removes nothing').toEqual([]);
    await page.locator('.al-sheet-undo').click();
    await page.locator('.lb-overlay.open .dialog-btn-confirm').click();
    await expect(feedback).toContainText(undoneWords({ removed: added, kept: [], gone: [] })[0]);
    const deleted = await page.evaluate(() => /** @type {any} */ (window).__E2E.deletedPaths || []);
    expect(deleted).toEqual(expect.arrayContaining(days.map(d => `overrides/${manualOverrideId(fx.A.name, d)}`)));
    const marks = await page.evaluate(() => /** @type {any} */ (window).__E2E.updateWrites || []);
    expect(marks, 'the log records its undo once').toHaveLength(1);
    expect(marks[0].data).toMatchObject({ undoneBy: 'G. Miller', undone: added });
    await expect(page.locator('.al-sheet-undo'), 'an undone Save is not offered again').toHaveCount(0);
    await expect(page.locator('#alSheetSaveBtn'), 'and its days are offered again').toHaveText(SAVE_WORDS.confirmFirst);
    expect(errors).toEqual([]);
});

// A SAVE WHERE ONLY SWAPS LANDED IS LOGGED WITH NOTHING ADDED, and as the newest log it hid the Undo of
// the Save before it (review of v26.22). The Undo on offer is the latest Save that ADDED leave
// (al-leave-plan.js → judgeUploads' `undoable`), and its line does not call it the last Save.
test('operations annual leave sheet: a later Save that added no leave does not take the earlier Save’s Undo away (review of v26.22)', async ({ page }) => {
    const errors = collectFatalErrors(page);
    const fx = await alSheetFixture();
    const key = `${fx.A.name}|${fx.dates.match}`;
    const log = (/** @type {string} */ id, /** @type {number} */ hoursAgo, /** @type {string[]} */ added) => ({ id, year: fx.year,
        fileDigest: fx.file.digest, workbookSha256: fx.file.source.sha256, clerksLastSaved: fx.file.source.clerksLastSaved,
        lastSavedByClerk: true, savedAt: { seconds: Math.floor(Date.now() / 1000) - hoursAgo * 3600 }, savedBy: 'A. Clerkson',
        appVersion: 'e2e', inLine: [key], added, writesMarked: true });
    await openAlSheet(page, fx.records, { docsByQuery: { overrides: fx.records,
        alUploads: [log('log-added', 2, [key]), log('log-swaps-only', 1, [])] } });
    await chooseLeaveFile(page, fx.text);
    await page.locator('#alSheetCheckBtn').click();
    await expect(page.locator('#alSheetFeedback')).toHaveText(checkedWords(2));
    const last = page.locator('.al-sheet-last');
    await expect(last).toContainText('The last Save here that added leave was');
    await expect(last).toContainText('adding 1 day of leave. Later Saves added none.');
    await expect(last.locator('.al-sheet-undo'), 'the earlier Save can still be undone').toHaveCount(1);
    await last.locator('.al-sheet-undo').click();
    await expect(page.locator('.lb-overlay.open .dialog-message')).toHaveText(undoConfirmWords(1));
    await page.locator('.lb-overlay.open .dialog-btn-cancel').click();
    expect(errors).toEqual([]);
});

test('operations annual leave sheet: the Undo keeps a day the same admin changed after the Save, though it is stamped before the log (external review, 15 Nov 2026)', async ({ page }) => {
    const errors = collectFatalErrors(page);
    const fx = await alSheetFixture();
    await openAlSheet(page, fx.records, { writesLand: true, docsByQuery: { overrides: fx.records, alUploads: [] } });
    await confirmA(page, fx);
    await page.locator('#alSheetSaveBtn').click();
    const feedback = page.locator('#alSheetFeedback');
    await expect(feedback).toContainText(SAVE_WORDS.recorded);
    // The same admin re-saves one of the Save's days in Admin, in another tab: the record Admin's leave
    // card writes — the same leave, the same name, no mark — stamped, as in the gap the review found,
    // before the log was written. Judged by its date, it was the Save's own and went with the Undo.
    const changed = manualOverrideId(fx.A.name, fx.dates.missing);
    await page.evaluate((id) => {
        const byQ = /** @type {any} */ (window).__E2E.docsByQuery;
        const row = byQ.overrides.find((/** @type {any} */ r) => r.id === id);
        delete row.uploadId;
        row.createdAt = byQ.alUploads[0].savedAt - 1;
    }, changed);
    await page.locator('.al-sheet-undo').click();
    await page.locator('.lb-overlay.open .dialog-btn-confirm').click();
    const words = undoneWords({ removed: [`${fx.A.name}|${fx.dates.restDay}`], kept: [`${fx.A.name}|${fx.dates.missing}`], gone: [] });
    await expect(feedback).toContainText(words[0]);
    await expect(feedback, 'and the receipt names the day it kept').toContainText(words[1]);
    const deleted = await page.evaluate(() => /** @type {any} */ (window).__E2E.deletedPaths || []);
    expect(deleted, 'the admin’s change is not taken back').not.toContain(`overrides/${changed}`);
    expect(deleted).toContain(`overrides/${manualOverrideId(fx.A.name, fx.dates.restDay)}`);
    expect(errors).toEqual([]);
});

test('operations annual leave sheet: a day a colleague saves after the check is refused by name, nothing of that person is written, and the answers are kept', async ({ page }) => {
    const fx = await alSheetFixture();
    await openAlSheet(page, fx.records, { writesLand: true });
    await confirmA(page, fx);
    // A manager saves a shift on the missing day, at its fixed id, after the check read it.
    await page.evaluate(([id, rec]) => { /** @type {any} */ (window).__E2E.docsByQuery.overrides.push({ id, ...rec }); },
        [manualOverrideId(fx.A.name, fx.dates.missing), { memberName: fx.A.name, date: fx.dates.missing, type: 'shift',
            value: '06:00-14:00', note: '', source: 'manual', changedBy: 'E. Manager', createdAt: 1_770_000_000_500 }]);
    await page.locator('#alSheetSaveBtn').click();
    const feedback = page.locator('#alSheetFeedback');
    await expect(feedback).toContainText(receiptWords({ days: 0, people: 0, refused: new Map([[fx.A.name, [fx.dates.missing]]]) })[0]);
    await expect(feedback, 'a refusal is not drawn as a success').toHaveClass(/huddle-feedback--err/);
    expect(await writtenTo(page, 'overrides'), 'nothing of the refused part').toEqual([]);
    expect(await writtenTo(page, 'alUploads'), 'nothing landed, so nothing is recorded').toEqual([]);
    // The fresh check shows the colleague's shift; the rest day's answer is kept, the confirmation is not.
    const a = personRow(page, fx.A.name);
    await a.locator('.al-sheet-person-head').click();
    await expect(a.locator('.al-sheet-day--differs', { hasText: dayLabel(fx.dates.missing) })).toBeVisible();
    await expect(a.getByRole('radiogroup', { name: questionWords(fx.dates.restDay) }).getByRole('radio', { name: SAVE_WORDS.swapped })).toBeChecked();
    await expect(a.getByRole('checkbox', { name: confirmWords({ name: fx.A.name, add: 1, swap: 0 }) })).not.toBeChecked();
});

test('operations annual leave sheet: offline, the Save writes nothing, says so, and keeps every answer and tick', async ({ page, context }) => {
    // Offline, a read is answered from this device's cache, which the card refuses — so the fresh check
    // after a Save that sent nothing could only take the review off the screen, and every answer with it
    // (review, 14 Nov 2026). Nothing was sent, so nothing has changed: the review stays as it is.
    const fx = await alSheetFixture();
    await openAlSheet(page, fx.records, { writesLand: true });
    const a = await confirmA(page, fx);
    await context.setOffline(true);
    await page.evaluate(() => { /** @type {any} */ (window).__E2E.docsFromCache = true; });
    await page.locator('#alSheetSaveBtn').click();
    const feedback = page.locator('#alSheetFeedback');
    await expect(feedback).toContainText(SAVE_WORDS.offlineNow);
    expect(await writtenTo(page, 'overrides')).toEqual([]);
    expect(await writtenTo(page, 'alUploads')).toEqual([]);
    await expect(page.locator('#alSheetResult'), 'the review stays on screen').toBeVisible();
    await expect(a.getByRole('radiogroup', { name: questionWords(fx.dates.restDay) }).getByRole('radio', { name: SAVE_WORDS.swapped }),
        'the answer stays').toBeChecked();
    await expect(a.getByRole('checkbox', { name: confirmWords({ name: fx.A.name, add: 2, swap: 0 }) }), 'and the tick').toBeChecked();
    await context.setOffline(false);
    await page.evaluate(() => { /** @type {any} */ (window).__E2E.docsFromCache = false; });
    await page.locator('#alSheetSaveBtn').click();
    await expect(feedback, 'back online, the same Save goes through').toContainText(receiptWords({ days: 2, people: 1, refused: new Map() })[0]);
});

test('operations annual leave sheet: while a Save or an Undo is on its way the card is locked, and an update and a notification tap both wait', async ({ page }) => {
    // The old controls were planned from a check the Save is about to make wrong, so the whole card is
    // locked until the fresh check has drawn (operations-al-save.js → runSave). The Undo is the case that
    // proves the TAP waits for the work itself: after a Save nothing is unsaved on screen, and held at a
    // read nothing is being written, so only the Undo running can hold it.
    const fx = await alSheetFixture();
    await openAlSheet(page, fx.records, { writesLand: true });
    await confirmA(page, fx);
    const result = page.locator('#alSheetResult');
    const feedback = page.locator('#alSheetFeedback');
    const release = () => page.evaluate(() => { const e = /** @type {any} */ (window).__E2E; e.txHold = false; e._txGate = null; e.releaseTx?.(); });
    const saveWorking = () => page.evaluate(async () => (await import('/operations-al-save.js')).alSaveWorking());
    /** @param {string} why */
    const lockedNow = async (why) => {
        for (const id of ['#alSheetCheckBtn', '#alSheetClearBtn', '#alSheetFileInput', '#alSheetPaste']) await expect(page.locator(id), why).toBeDisabled();
        expect(await result.evaluate(n => /** @type {HTMLElement} */ (n).inert), `${why}: the result cannot be used`).toBe(true);
        expect(await alSheetCardBusy(page), `${why}: an update waits`).toBe(true);
        expect(await tapIsHeld(page), `${why}: a notification tap waits`).toBe(true);
        expect(await saveWorking(), `${why}: the Save's own flag`).toBe(true);
    };
    await page.evaluate(() => { /** @type {any} */ (window).__E2E.txHold = true; });
    await page.locator('#alSheetSaveBtn').click();
    await expect(feedback).toHaveText(savingWords(0, 2));
    await lockedNow('a Save on its way');
    await release();
    await expect(feedback).toContainText(SAVE_WORDS.recorded);
    expect(await result.evaluate(n => /** @type {HTMLElement} */ (n).inert), 'unlocked once the fresh check has drawn').toBe(false);
    await expect(page.locator('#alSheetClearBtn')).toBeEnabled();
    expect(await tapIsHeld(page), 'saved, and nothing unsaved on screen: a tap goes straight through').toBe(false);
    expect(await saveWorking(), 'the Save has finished').toBe(false);

    // The Undo is held at its first READ, before anything is sent: no write is in flight to hold the tap
    // (operations-app.js → _opsBusy), so only the Undo running can.
    await page.evaluate(() => { /** @type {any} */ (window).__E2E.docsHeld = true; });
    await page.locator('.al-sheet-undo').click();
    await page.locator('.lb-overlay.open .dialog-btn-confirm').click();
    await expect(feedback).toHaveText(SAVE_WORDS.undoing);
    await lockedNow('an Undo on its way');
    await page.evaluate(() => { /** @type {any} */ (window).__E2E.docsHeld = false; });
    await expect(feedback).toContainText(undoneWords({ removed: [fx.dates.missing, fx.dates.restDay].map(d => `${fx.A.name}|${d}`).sort(), kept: [], gone: [] })[0]);
    expect(await tapIsHeld(page), 'undone: a tap goes straight through').toBe(false);
    expect(await saveWorking(), 'the Undo has finished').toBe(false);
});

test('operations annual leave sheet: a Save the app could not read back is recorded by the next check of the same file', async ({ page }) => {
    const fx = await alSheetFixture();
    await openAlSheet(page, fx.records, { writesLand: true });
    await confirmA(page, fx, 'free');
    await page.evaluate(() => { /** @type {any} */ (window).__E2E.docsFromCache = true; });
    await page.locator('#alSheetSaveBtn').click();
    const feedback = page.locator('#alSheetFeedback');
    await expect(feedback).toContainText(SAVE_WORDS.unreadAfter);
    await expect(feedback, 'and the fresh check could not read either').toContainText(CARD_WORDS.offline);
    expect(await writtenTo(page, 'overrides'), 'the rest day answered "free" writes nothing').toHaveLength(1);
    expect(await writtenTo(page, 'alUploads')).toEqual([]);
    await page.evaluate(() => { /** @type {any} */ (window).__E2E.docsFromCache = false; });
    // Another copy of the sheet checked meanwhile is not where that Save's record belongs: its log would
    // carry the wrong copy's save time, and order every later upload by it.
    const other = await alSheetFixture({ savedDaysAgo: 1 });
    await chooseLeaveFile(page, other.text);
    await page.locator('#alSheetCheckBtn').click();
    await expect(feedback).toHaveText(checkedWords(2));
    expect(await writtenTo(page, 'alUploads'), 'not recorded against another copy').toEqual([]);
    await chooseLeaveFile(page, fx.text);
    await page.locator('#alSheetCheckBtn').click();
    await expect(feedback).toContainText(SAVE_WORDS.nowRecorded);
    const logs = await writtenTo(page, 'alUploads');
    expect(logs).toHaveLength(1);
    expect(logs[0].data.added).toEqual([`${fx.A.name}|${fx.dates.missing}`]);
    expect(logs[0].data.fileDigest, 'recorded against the copy it saved').toBe(fx.file.digest);
});

test('operations annual leave sheet: a Save whose answer is lost and which cannot be read back says neither "saved" nor "nothing"', async ({ page }) => {
    // It may have landed whole, or not at all; only the next read can say. The next check of the same
    // file reads it, and records what landed.
    const fx = await alSheetFixture();
    await openAlSheet(page, fx.records, { writesLand: true });
    await confirmA(page, fx);
    await page.evaluate(() => { const e = /** @type {any} */ (window).__E2E; e.txLoseAnswer = true; e.docsFromCache = true; });
    await page.locator('#alSheetSaveBtn').click();
    const feedback = page.locator('#alSheetFeedback');
    await expect(feedback).toContainText(SAVE_WORDS.lost);
    await expect(feedback).toContainText(SAVE_WORDS.unreadAfter);
    await expect(feedback, 'it may have landed: "nothing" would be a guess').not.toContainText('Nothing was saved');
    await expect(feedback).not.toContainText('Saved ');
    await page.evaluate(() => { /** @type {any} */ (window).__E2E.docsFromCache = false; });
    await page.locator('#alSheetCheckBtn').click();
    await expect(feedback).toContainText(SAVE_WORDS.nowRecorded);
    expect((await writtenTo(page, 'alUploads'))[0].data.added).toEqual([fx.dates.missing, fx.dates.restDay].map(d => `${fx.A.name}|${d}`).sort());
});

test('operations annual leave sheet: a Save whose answer is lost on the way back is reported from what landed, and recorded so it can be undone', async ({ page }) => {
    // The server committed and the answer never came: the Save itself saw a lost connection. The read
    // after it is what says what was saved (al-leave-plan.js → landedWrites), and the log is written
    // from it — "Nothing was saved" here would be untrue, and an unrecorded Save could not be undone.
    const fx = await alSheetFixture();
    await openAlSheet(page, fx.records, { writesLand: true });
    await confirmA(page, fx);
    await page.evaluate(() => { /** @type {any} */ (window).__E2E.txLoseAnswer = true; });
    await page.locator('#alSheetSaveBtn').click();
    const feedback = page.locator('#alSheetFeedback');
    await expect(feedback).toContainText(SAVE_WORDS.recorded);
    await expect(feedback).toContainText(receiptWords({ days: 2, people: 1, refused: new Map() })[0]);
    await expect(feedback, 'read back whole, it did not stop part way').not.toContainText(SAVE_WORDS.lost);
    await expect(feedback).not.toContainText('Nothing was saved');
    const logs = await writtenTo(page, 'alUploads');
    expect(logs).toHaveLength(1);
    expect(logs[0].data.added).toEqual([fx.dates.missing, fx.dates.restDay].map(d => `${fx.A.name}|${d}`).sort());
    await expect(page.locator('.al-sheet-undo')).toBeVisible();
});

/**
 * Make every member lookup throw — nothing on the card's path is meant to — from the moment `when`
 * holds in the page. @param {import('@playwright/test').Page} page @param {'logged'|'now'} when
 */
const faultLookups = (page, when) => page.evaluate(async (w) => {
    const { teamMembers } = await import('/roster-data.js');
    const find = Array.prototype.find.bind(teamMembers);
    const due = () => w === 'now' || (/** @type {any} */ (window).__E2E?.setWrites || [])
        .some((/** @type {any} */ x) => String(x.path).startsWith('alUploads/'));
    /** @type {any} */ (teamMembers).find = (/** @type {any} */ pred) => { if (due()) throw new TypeError('e2e fault'); return find(pred); };
}, when);

test('operations annual leave sheet: a fault in the check after a Save keeps its receipt, and never says "Nothing was saved"', async ({ page }) => {
    // The receipt says what was saved, so the check's own fault line, which says nothing was, would
    // contradict it (operations-al-sheet.js). The fault waits for the Save's record, so it lands there.
    const fx = await alSheetFixture();
    await openAlSheet(page, fx.records, { writesLand: true });
    await confirmA(page, fx);
    await faultLookups(page, 'logged');
    await page.locator('#alSheetSaveBtn').click();
    const feedback = page.locator('#alSheetFeedback');
    await expect(feedback).toContainText(SAVE_WORDS.recheckFailed);
    await expect(feedback).toContainText(receiptWords({ days: 2, people: 1, refused: new Map() })[0]);
    await expect(feedback).toContainText(SAVE_WORDS.recorded);
    await expect(feedback).not.toContainText('Nothing was saved');
    await expect(page.locator('#alSheetResult')).toBeHidden();
    for (const id of ['#alSheetCheckBtn', '#alSheetFileInput', '#alSheetPaste']) await expect(page.locator(id), 'unlocked').toBeEnabled();
    expect(await writtenTo(page, 'overrides')).toHaveLength(2);
});

test('operations annual leave sheet: a fault after the Save’s writes still unlocks the card, and says neither "saved" nor "nothing"', async ({ page }) => {
    // Held at the read after the Save, the fault lands in what follows it, the record's comparison
    // (operations-al-save.js → runSave). Left uncaught, "Saving…" stayed on screen and the card stayed
    // locked until a reload.
    const fx = await alSheetFixture();
    await openAlSheet(page, fx.records, { writesLand: true });
    await confirmA(page, fx);
    await page.evaluate(() => { /** @type {any} */ (window).__E2E.docsHeld = true; });
    await page.locator('#alSheetSaveBtn').click();
    await expect.poll(async () => (await writtenTo(page, 'overrides')).length, 'the writes went first').toBe(2);
    await faultLookups(page, 'now');
    await page.evaluate(() => { /** @type {any} */ (window).__E2E.docsHeld = false; });
    const feedback = page.locator('#alSheetFeedback');
    await expect(feedback).toContainText(SAVE_WORDS.failed);
    await expect(feedback, 'and the check after it').toContainText(SAVE_WORDS.recheckFailed);
    await expect(feedback).not.toContainText('Nothing was saved');
    await expect(feedback).not.toContainText(savingWords(2, 2));
    await expect(feedback).toHaveClass(/huddle-feedback--err/);
    for (const id of ['#alSheetCheckBtn', '#alSheetFileInput', '#alSheetPaste']) await expect(page.locator(id), 'unlocked').toBeEnabled();
    expect(await page.evaluate(async () => (await import('/operations-al-save.js')).alSaveWorking()), 'nothing is running').toBe(false);
    // What landed is unknown until a check reads it, so the tick and the answer wait for that check —
    // and a tap asks first, rather than taking them away (operations-al-save.js → the memory).
    expect(await tapIsHeld(page), 'the answers wait for the next check').toBe(true);
    expect(await writtenTo(page, 'alUploads'), 'never recorded').toEqual([]);
});

test('operations annual leave sheet: a copy older than one already saved here is a check only, and says why', async ({ page }) => {
    const fx = await alSheetFixture();
    const newer = new Date(Date.now() - 86_400_000).toISOString().replace(/\.\d{3}Z$/, 'Z');   // the file's copy is 2 days old
    await openAlSheet(page, fx.records, { writesLand: true, docsByQuery: { overrides: fx.records, alUploads: [{ id: 'log-1', year: fx.year,
        fileDigest: `sha256:${'f'.repeat(64)}`, workbookSha256: 'f'.repeat(64), clerksLastSaved: newer, lastSavedByClerk: true,
        savedAt: Date.now() - 3_600_000, savedBy: 'G. Miller', appVersion: 'e2e', inLine: [], added: [] }] } });
    await chooseLeaveFile(page, fx.text);
    await page.locator('#alSheetCheckBtn').click();
    const result = page.locator('#alSheetResult');
    await expect(result.locator('.al-sheet-warn')).toContainText('This copy is older, so it can’t be saved');
    await expect(result.locator('#alSheetSaveBtn, .al-sheet-confirm, .al-sheet-answer')).toHaveCount(0);
    await expect(result.locator('.al-sheet-note').last()).toHaveText(CARD_WORDS.checkOnly);
});

test('operations annual leave sheet: unsaved answers ask before Clear, and before a drawer link leaves the page', async ({ page }) => {
    const fx = await alSheetFixture();
    await openAlSheet(page, fx.records, { writesLand: true });
    await confirmA(page, fx);
    await page.locator('#alSheetClearBtn').click();
    await expect(page.locator('.lb-overlay.open .dialog-message')).toHaveText(SAVE_WORDS.clearAsk);
    await page.locator('.lb-overlay.open .dialog-btn-cancel').click();
    await expect(page.locator('#alSheetResult'), 'Cancel keeps the review').toBeVisible();
    // Closing the tab: the browser's own question is armed (its dialog cannot be scripted; its contract can).
    const armed = () => page.evaluate(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; });
    expect(await armed(), 'answers on screen arm the leave-page warning').toBe(true);
    // A drawer link asks, and a Cancel stays.
    await page.locator('#navMenuBtn').click();
    await page.locator('.nav-panel-pill--calendar').click();
    await expect(page.locator('.lb-overlay.open .dialog-message')).toHaveText('You have unsaved changes. Leave this page anyway?');
    await page.locator('.lb-overlay.open .dialog-btn-cancel').click();
    await expect(page).toHaveURL(/operations\.html/);
    // Signing out asks too, and a Cancel keeps the session and the answers.
    if (!(await page.locator('#navSignOutBtn').isVisible())) await page.locator('#navMenuBtn').click();
    await page.locator('#navSignOutBtn').click();
    await expect(page.locator('.lb-overlay.open .dialog-message')).toHaveText('You have unsaved changes. Sign out anyway?');
    await page.locator('.lb-overlay.open .dialog-btn-cancel').click();
    expect(await page.evaluate(() => localStorage.getItem('myb_admin_session')), 'a declined sign-out keeps the session').not.toBeNull();
    const a = personRow(page, fx.A.name);
    await expect(a.getByRole('radiogroup', { name: questionWords(fx.dates.restDay) }).getByRole('radio', { name: SAVE_WORDS.swapped })).toBeChecked();
    // Unticked, the "Swapped — counts" answer is still something a Save would write.
    await a.getByRole('checkbox', { name: confirmWords({ name: fx.A.name, add: 2, swap: 0 }) }).uncheck();
    expect(await armed(), 'an answer is still on screen').toBe(true);
    // Clear, answered "Clear", takes the answers with it: nothing is left to warn about.
    await page.locator('#alSheetClearBtn').click();
    await page.locator('.lb-overlay.open .dialog-btn-confirm').click();
    await expect(page.locator('#alSheetResult')).toBeHidden();
    expect(await armed(), 'cleared: the leave-page warning stands down').toBe(false);
    expect(await tapIsHeld(page), 'and a tap goes straight through').toBe(false);
});

// ── THE SAVE'S REVIEW FIXES (15 Nov 2026) ───────────────────────────────────────────────────────────
// Each test below failed against the Save as first built (v26.13 before its review), for the reason it
// names; every name and date comes from al-sheet-fixture.js, by rule.

test('operations annual leave sheet: Check again, a new copy of the file and the paste box keep every answer, and a tick whose Save is unchanged', async ({ page }) => {
    // The receipts say "Check again", and a check that fails offline takes the review off the screen. The
    // answers are the admin's, so they outlive any new check of the days it still asks about; a tick
    // outlives one whose box would say exactly the same (operations-al-save.js → the memory).
    const fx = await alSheetFixture();
    await openAlSheet(page, fx.records, { writesLand: true });
    await confirmA(page, fx);
    const feedback = page.locator('#alSheetFeedback');
    /** @param {string} why */
    const kept = async (why) => {
        const a = personRow(page, fx.A.name);
        if (!(await a.locator('.al-sheet-person-body').isVisible())) await a.locator('.al-sheet-person-head').click();
        await expect(a.getByRole('radiogroup', { name: questionWords(fx.dates.restDay) }).getByRole('radio', { name: SAVE_WORDS.swapped }), why).toBeChecked();
        await expect(a.getByRole('checkbox', { name: confirmWords({ name: fx.A.name, add: 2, swap: 0 }) }), why).toBeChecked();
        await expect(page.locator('#alSheetSaveBtn'), why).toHaveText(saveButtonWords({ days: 2, people: 1 }));
    };
    await page.locator('#alSheetCheckBtn').click();
    await expect(feedback).toHaveText(checkedWords(2));
    await kept('Check again');
    await chooseLeaveFile(page, fx.text);
    await page.locator('#alSheetCheckBtn').click();
    await expect(feedback).toHaveText(checkedWords(2));
    await kept('the same file chosen again');
    await page.locator('#alSheetPaste').fill(fx.text);
    await page.locator('#alSheetCheckBtn').click();
    await expect(feedback).toHaveText(checkedWords(2));
    await kept('the file pasted');
    // A check that cannot read takes the review off the screen, and the answers wait for the next one.
    await page.evaluate(() => { /** @type {any} */ (window).__E2E.docsFromCache = true; });
    await page.locator('#alSheetCheckBtn').click();
    await expect(feedback).toContainText(CARD_WORDS.offline);
    await expect(page.locator('#alSheetResult')).toBeHidden();
    expect(await tapIsHeld(page), 'answers off the screen are still unsaved: a tap asks first').toBe(true);
    expect(await alSheetCardBusy(page), 'and an update waits for them: its reload would take them away').toBe(true);
    await page.evaluate(() => { /** @type {any} */ (window).__E2E.docsFromCache = false; });
    await page.locator('#alSheetCheckBtn').click();
    await expect(feedback).toHaveText(checkedWords(2));
    await kept('after a check that could not read');
});

test('operations annual leave sheet: the header logo asks before leaving unsaved answers, as the drawer does', async ({ page }) => {
    // A phone never shows the browser's own question, and the logo was the one way off the page that did
    // not ask (page-session.js → leaveAfterAsking). "Leave" must not meet that question a second time.
    const fx = await alSheetFixture();
    await openAlSheet(page, fx.records, { writesLand: true });
    const a = await confirmA(page, fx);
    await page.locator('#appIcon').click();
    await expect(page.locator('.lb-overlay.open .dialog-message')).toHaveText('You have unsaved changes. Leave this page anyway?');
    await page.locator('.lb-overlay.open .dialog-btn-cancel').click();
    await expect(page).toHaveURL(/operations\.html/);
    await expect(a.getByRole('checkbox', { name: confirmWords({ name: fx.A.name, add: 2, swap: 0 }) }), 'Cancel keeps the review').toBeChecked();
    await page.locator('#appIcon').click();
    await page.locator('.lb-overlay.open .dialog-btn-confirm').click();
    await expect(page, 'Leave goes to the calendar').not.toHaveURL(/operations\.html/);
});

test('operations annual leave sheet: an Undo cut short is finished by pressing Undo again', async ({ page }) => {
    // The log can be marked undone only once (firestore.rules → alUploads). An Undo whose deletes landed
    // and whose mark did not left a button that removed nothing and marked nothing, for good; what it had
    // already taken back now counts as taken back (al-leave-save.js → undoUpload).
    const fx = await alSheetFixture();
    await openAlSheet(page, fx.records, { writesLand: true });
    await confirmA(page, fx);
    await page.locator('#alSheetSaveBtn').click();
    const feedback = page.locator('#alSheetFeedback');
    await expect(feedback).toContainText(SAVE_WORDS.recorded);
    const added = [fx.dates.missing, fx.dates.restDay].map(d => `${fx.A.name}|${d}`).sort();
    await page.evaluate(() => { /** @type {any} */ (window).__E2E.txFailOn = { col: 'alUploads', code: 'unavailable', times: 1 }; });
    await page.locator('.al-sheet-undo').click();
    await page.locator('.lb-overlay.open .dialog-btn-confirm').click();
    await expect(feedback).toContainText(SAVE_WORDS.undoStopped);
    const deleted = await page.evaluate(() => /** @type {any} */ (window).__E2E.deletedPaths || []);
    expect(deleted, 'the days went').toEqual(expect.arrayContaining([fx.dates.missing, fx.dates.restDay].map(d => `overrides/${manualOverrideId(fx.A.name, d)}`)));
    expect(await page.evaluate(() => /** @type {any} */ (window).__E2E.updateWrites || []), 'the mark did not').toEqual([]);
    await expect(page.locator('.al-sheet-undo'), 'so the Undo is still offered').toBeVisible();
    await page.locator('.al-sheet-undo').click();
    await page.locator('.lb-overlay.open .dialog-btn-confirm').click();
    await expect(feedback).toContainText(SAVE_WORDS.undoAllGone);
    const marks = await page.evaluate(() => /** @type {any} */ (window).__E2E.updateWrites || []);
    expect(marks, 'marked once, now').toHaveLength(1);
    expect(marks[0].data).toMatchObject({ undoneBy: 'G. Miller', undone: added });
    await expect(page.locator('.al-sheet-undo'), 'finished: not offered again').toHaveCount(0);
    await expect(page.locator('#alSheetSaveBtn'), 'and its days are offered again').toHaveText(SAVE_WORDS.confirmFirst);
});

test('operations annual leave sheet: a Save that landed nothing records nothing, and the last Save keeps its Undo', async ({ page }) => {
    // A part that never got its answer may have landed, so the Save reads back; when the read shows nothing
    // of it, there is nothing to record. A log with nothing added became the newest and hid the earlier
    // Save's Undo (operations-al-save.js → record).
    const fx = await alSheetFixture();
    const earlier = { id: 'log-earlier', year: fx.year, fileDigest: fx.file.digest, workbookSha256: fx.file.source.sha256,
        clerksLastSaved: fx.file.source.clerksLastSaved, lastSavedByClerk: true, savedAt: Date.now() - 3_600_000,
        savedBy: 'G. Miller', appVersion: 'e2e', inLine: [`${fx.B.name}|${fx.dates.bMatch}`], added: [`${fx.B.name}|${fx.dates.bMatch}`] };
    await openAlSheet(page, fx.records, { writesLand: true, docsByQuery: { overrides: fx.records, alUploads: [earlier] } });
    await confirmA(page, fx);
    await expect(page.locator('.al-sheet-last')).toContainText('adding 1 day of leave');
    await page.evaluate(() => { /** @type {any} */ (window).__E2E.txFailOn = { col: 'overrides', code: 'unavailable', times: 1 }; });
    await page.locator('#alSheetSaveBtn').click();
    const feedback = page.locator('#alSheetFeedback');
    await expect(feedback).toContainText(SAVE_WORDS.lost);
    expect(await writtenTo(page, 'overrides'), 'premise: nothing landed').toEqual([]);
    expect(await writtenTo(page, 'alUploads'), 'nothing landed, so nothing is recorded').toEqual([]);
    await expect(page.locator('.al-sheet-last'), 'the earlier Save keeps its Undo').toContainText('adding 1 day of leave');
});

test('operations annual leave sheet: a rest day answered "Rest day — free" is named on the receipt, and leaves nothing unsaved', async ({ page }) => {
    // A Save may not do nothing silently (.claude/rules/admin.md), and a free answer writes nothing — so
    // after the Save, every way off the page asked about "unsaved changes" that a Save would never make.
    const fx = await alSheetFixture();
    await openAlSheet(page, fx.records, { writesLand: true });
    await confirmA(page, fx, 'free');
    expect(await tapIsHeld(page), 'premise: a confirmed person holds a tap').toBe(true);
    await page.locator('#alSheetSaveBtn').click();
    const feedback = page.locator('#alSheetFeedback');
    await expect(feedback).toContainText(receiptWords({ days: 1, people: 1, refused: new Map() })[0]);
    await expect(feedback).toContainText(leftFreeWords(fx.A.name, [{ date: fx.dates.restDay, held: false }]));
    const a = personRow(page, fx.A.name);
    await a.locator('.al-sheet-person-head').click();
    await expect(a.getByRole('radiogroup', { name: questionWords(fx.dates.restDay) })
        .getByRole('radio', { name: SAVE_WORDS.free }), 'the answer is still shown').toBeChecked();
    expect(await tapIsHeld(page), 'a free answer writes nothing, so nothing is left unsaved').toBe(false);
    const armed = await page.evaluate(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; });
    expect(armed, 'and leaving asks nothing').toBe(false);
});

test('operations annual leave sheet: leave the admin books by hand after the check is not counted as the Save’s, nor recorded for its Undo', async ({ page }) => {
    // The read after the Save says what landed (al-leave-plan.js → landedWrites), and a record at a day's
    // fixed id that the admin wrote looks like the Save's own. A day the Save was refused on never is.
    const fx = await alSheetFixture({ bMissing: true });
    await openAlSheet(page, fx.records, { writesLand: true });
    await confirmA(page, fx);
    const b = personRow(page, fx.B.name);
    await b.locator('.al-sheet-person-head').click();
    await b.getByRole('checkbox', { name: confirmWords({ name: fx.B.name, add: 1, swap: 0 }) }).check();
    await page.evaluate(([id, rec]) => { /** @type {any} */ (window).__E2E.docsByQuery.overrides.push({ id, ...rec }); },
        [manualOverrideId(fx.A.name, fx.dates.missing), { memberName: fx.A.name, date: fx.dates.missing, type: 'annual_leave',
            value: 'AL', note: '', source: 'manual', changedBy: 'G. Miller', createdAt: Date.now() }]);
    await page.locator('#alSheetSaveBtn').click();
    const feedback = page.locator('#alSheetFeedback');
    await expect(feedback).toContainText(receiptWords({ days: 1, people: 1, refused: new Map() })[0]);
    await expect(feedback).toContainText(receiptWords({ days: 0, people: 0, refused: new Map([[fx.A.name, [fx.dates.missing]]]) })[0]);
    const logs = await writtenTo(page, 'alUploads');
    expect(logs).toHaveLength(1);
    expect(logs[0].data.added, 'only what the Save wrote').toEqual([`${fx.B.name}|${fx.dates.bMissing}`]);
});

test('operations annual leave sheet: days the admin booked by hand exactly as the Save would are not taken for the Save’s own', async ({ page }) => {
    // The checked commit recognises its OWN write after a lost answer (admin-override-store.js →
    // alreadyDone). On a first attempt nothing of the Save's can be there yet, so an identical record is
    // somebody's, and is refused like any other change.
    const fx = await alSheetFixture();
    await openAlSheet(page, fx.records, { writesLand: true });
    await confirmA(page, fx);
    /** @param {string} date @param {Record<string, any>} [extra] */
    const own = (date, extra = {}) => [manualOverrideId(fx.A.name, date), { memberName: fx.A.name, date, type: 'annual_leave',
        value: 'AL', note: '', source: 'manual', changedBy: 'G. Miller', createdAt: Date.now(), ...extra }];
    await page.evaluate((rows) => { for (const [id, rec] of rows) /** @type {any} */ (window).__E2E.docsByQuery.overrides.push({ id, ...rec }); },
        [own(fx.dates.missing), own(fx.dates.restDay, { replacedType: 'shift' })]);
    await page.locator('#alSheetSaveBtn').click();
    const feedback = page.locator('#alSheetFeedback');
    await expect(feedback).toContainText(receiptWords({ days: 0, people: 0,
        refused: new Map([[fx.A.name, [fx.dates.missing, fx.dates.restDay].sort()]]) })[0]);
    expect(await writtenTo(page, 'alUploads'), 'nothing of the Save landed, so nothing is recorded').toEqual([]);
});

test('operations annual leave sheet: a Save whose record could not be written is recorded by the next check of the same file', async ({ page }) => {
    // Only a failed READ after the Save was finished later; a failed WRITE of the record was lost for good,
    // and with it the Undo and the protection against leave cancelled since.
    const fx = await alSheetFixture();
    await openAlSheet(page, fx.records, { writesLand: true });
    await confirmA(page, fx);
    await page.evaluate(() => { /** @type {any} */ (window).__E2E.txFailOn = { col: 'alUploads', code: 'unavailable', times: 1 }; });
    await page.locator('#alSheetSaveBtn').click();
    const feedback = page.locator('#alSheetFeedback');
    await expect(feedback).toContainText(SAVE_WORDS.notRecordedYet);
    expect(await writtenTo(page, 'alUploads')).toEqual([]);
    await page.locator('#alSheetCheckBtn').click();
    await expect(feedback).toContainText(SAVE_WORDS.nowRecorded);
    const logs = await writtenTo(page, 'alUploads');
    expect(logs).toHaveLength(1);
    expect(logs[0].data.added).toEqual([fx.dates.missing, fx.dates.restDay].map(d => `${fx.A.name}|${d}`).sort());
    await expect(page.locator('.al-sheet-undo')).toBeVisible();
});

test('operations annual leave sheet: when the record of Saves cannot be read after a Save, the receipt promises no Undo it cannot show', async ({ page }) => {
    const fx = await alSheetFixture();
    await openAlSheet(page, fx.records, { writesLand: true });
    await confirmA(page, fx);
    await page.evaluate(() => { /** @type {any} */ (window).__E2E.failGetDocsByQuery = { alUploads: true }; });
    await page.locator('#alSheetSaveBtn').click();
    const feedback = page.locator('#alSheetFeedback');
    await expect(feedback).toContainText(SAVE_WORDS.recordedUndoLater);
    await expect(feedback).not.toContainText(SAVE_WORDS.recorded);
    await expect(page.locator('.al-sheet-undo')).toHaveCount(0);
});

test('operations annual leave sheet: a Save that cannot load what it writes with says it never started, and keeps the review', async ({ page }) => {
    // The store loads with the Save (al-leave-save.js → adminStore). When it cannot — offline after an
    // update, say — nothing has been sent, and "stopped part way" would send the admin looking for a part.
    const fx = await alSheetFixture();
    await page.route('**/admin-override-store.js', route => route.abort('failed'));
    await openAlSheet(page, fx.records, { writesLand: true });
    const a = await confirmA(page, fx);
    await page.locator('#alSheetSaveBtn').click();
    const feedback = page.locator('#alSheetFeedback');
    await expect(feedback).toContainText(SAVE_WORDS.notStarted);
    expect(await writtenTo(page, 'overrides')).toEqual([]);
    await expect(a.getByRole('checkbox', { name: confirmWords({ name: fx.A.name, add: 2, swap: 0 }) }), 'the review stays').toBeChecked();
});

test('operations annual leave sheet: a person whose only leave is undated over-quota days is never said to have none', async ({ page }) => {
    // "No days on the sheet" sat under "The sheet deducts 2 more days over quota with no date" — both
    // about the same person, and the first untrue (review, 15 Nov 2026).
    const fx = await alSheetFixture({ bUndatedOnly: 2 });
    await openAlSheet(page, fx.records);
    await chooseLeaveFile(page, fx.text);
    await page.locator('#alSheetCheckBtn').click();
    await expect(page.locator('#alSheetFeedback')).toHaveText(checkedWords(2));
    const b = personRow(page, fx.B.name);
    await b.locator('.al-sheet-person-head').click();
    await expect(b).toContainText('2 more days over quota with no date');
    await expect(b.getByText(CARD_WORDS.noDays)).toHaveCount(0);
});

test('operations annual leave sheet: an Undo that cannot load what it writes with says it never started', async ({ page }) => {
    // The Undo deletes through the same checked commit. Nothing was sent, so "stopped part way" would be
    // untrue, and pressing again would only meet the same failure until the page is reloaded.
    const fx = await alSheetFixture();
    const earlier = { id: 'log-earlier', year: fx.year, fileDigest: fx.file.digest, workbookSha256: fx.file.source.sha256,
        clerksLastSaved: fx.file.source.clerksLastSaved, lastSavedByClerk: true, savedAt: Date.now() - 3_600_000,
        savedBy: 'G. Miller', appVersion: 'e2e', inLine: [`${fx.B.name}|${fx.dates.bMatch}`], added: [`${fx.B.name}|${fx.dates.bMatch}`] };
    await page.route('**/admin-override-store.js', route => route.abort('failed'));
    await openAlSheet(page, fx.records, { writesLand: true, docsByQuery: { overrides: fx.records, alUploads: [earlier] } });
    await chooseLeaveFile(page, fx.text);
    await page.locator('#alSheetCheckBtn').click();
    await expect(page.locator('.al-sheet-undo')).toBeVisible();
    const reads = () => page.evaluate(() => /** @type {any} */ (window).__E2E.docReads || 0);
    const before = await reads();
    await page.locator('.al-sheet-undo').click();
    await page.locator('.lb-overlay.open .dialog-btn-confirm').click();
    await expect(page.locator('#alSheetFeedback')).toContainText(SAVE_WORDS.undoNotStarted);
    expect(await page.evaluate(() => /** @type {any} */ (window).__E2E.deletedPaths || []), 'nothing was taken back').toEqual([]);
    // Nothing was sent, so nothing is checked again: the Undo's own read of the one person it names, and no more.
    expect(await reads(), 'no fresh check after an Undo that sent nothing').toBe(before + 1);
    await expect(page.locator('.al-sheet-undo'), 'its review, and its Undo, stay').toBeVisible();
});

test('operations annual leave sheet: an Undo that cannot read the records takes nothing back, says so, and keeps its review', async ({ page, context }) => {
    // The Undo reads the app's records before it removes anything (operations-al-save.js → runUndo). When
    // that read fails nothing was sent, so "stopped part way" was untrue — and offline, the check after it
    // could only be refused, taking the review and the Undo it pointed at off the screen.
    const fx = await alSheetFixture();
    await openAlSheet(page, fx.records, { writesLand: true });
    await confirmA(page, fx);
    await page.locator('#alSheetSaveBtn').click();
    const feedback = page.locator('#alSheetFeedback');
    await expect(feedback).toContainText(SAVE_WORDS.recorded);
    const undo = async () => {
        await page.locator('.al-sheet-undo').click();
        await page.locator('.lb-overlay.open .dialog-btn-confirm').click();
    };
    const deleted = () => page.evaluate(() => /** @type {any} */ (window).__E2E.deletedPaths || []);

    await page.evaluate(() => { /** @type {any} */ (window).__E2E.failGetDocsByQuery = { overrides: true }; });
    await undo();
    await expect(feedback).toContainText(SAVE_WORDS.undoUnread);
    await expect(feedback).not.toContainText(SAVE_WORDS.undoStopped);
    expect(await deleted(), 'nothing was taken back').toEqual([]);
    await expect(page.locator('.al-sheet-undo'), 'the Undo is still there to press').toBeVisible();
    await expect(page.locator('.al-sheet-undo')).toBeEnabled();
    await page.evaluate(() => { /** @type {any} */ (window).__E2E.failGetDocsByQuery = null; });

    await context.setOffline(true);
    await page.evaluate(() => { /** @type {any} */ (window).__E2E.docsFromCache = true; });
    await undo();
    await expect(feedback).toContainText(SAVE_WORDS.undoOffline);
    expect(await deleted(), 'offline, nothing was taken back').toEqual([]);
    await expect(page.locator('#alSheetResult'), 'the review stays on screen').toBeVisible();
    await expect(page.locator('.al-sheet-undo'), 'and its Undo').toBeVisible();

    await context.setOffline(false);
    await page.evaluate(() => { /** @type {any} */ (window).__E2E.docsFromCache = false; });
    await undo();
    const added = [fx.dates.missing, fx.dates.restDay].map(d => `${fx.A.name}|${d}`).sort();
    await expect(feedback, 'back online, the same Undo goes through').toContainText(undoneWords({ removed: added, kept: [], gone: [] })[0]);
});

test('operations annual leave sheet: what the Save writes with is loaded when a Save is offered, not when it is pressed', async ({ page }) => {
    // Loaded with the review, from the release this page came from: an update that arrives before the
    // press cannot hand the Save a newer store than its page (al-leave-save.js → preloadSaveStore).
    const fx = await alSheetFixture();
    const loaded = [];
    page.on('request', r => { if (/\/admin-override-store\.js(?:\?|$)/.test(r.url())) loaded.push(r.url()); });
    await openAlSheet(page, fx.records, { writesLand: true });
    expect(loaded, 'the page alone loads none of it').toEqual([]);
    await chooseLeaveFile(page, fx.text);
    await page.locator('#alSheetCheckBtn').click();
    await expect(page.locator('#alSheetSaveBtn')).toBeVisible();
    await expect.poll(() => loaded.length, 'a check that offers a Save loads it, before anything is pressed').toBeGreaterThan(0);
});

test('operations annual leave sheet: clearing out old records never holds the Save', async ({ page }) => {
    // Housekeeping (al-leave-save.js → pruneUploadLogs) deletes in a batch, and a batch with no answer
    // waits for the connection. Awaited inside the Save, it kept the card locked on "Saving…".
    const fx = await alSheetFixture();
    const old = { id: 'log-too-old', year: new Date().getFullYear() - 2, fileDigest: `sha256:${'a'.repeat(64)}`, workbookSha256: 'a'.repeat(64),
        clerksLastSaved: '2000-01-03T09:00:00Z', lastSavedByClerk: true, savedAt: Date.now() - 800 * 86_400_000,
        savedBy: 'G. Miller', appVersion: 'e2e', inLine: [], added: [] };
    await openAlSheet(page, fx.records, { writesLand: true, docsByQuery: { overrides: fx.records, alUploads: [old] } });
    await confirmA(page, fx);
    await page.evaluate(() => { /** @type {any} */ (window).__E2E.holdBatchCommits = true; });
    await page.locator('#alSheetSaveBtn').click();
    const feedback = page.locator('#alSheetFeedback');
    await expect(feedback).toContainText(SAVE_WORDS.recorded);
    await expect(page.locator('#alSheetClearBtn'), 'the card is unlocked while the clearing waits').toBeEnabled();
    await expect.poll(() => page.evaluate(() => /** @type {any} */ (window).__E2E.batchDeletes || []), 'premise: the clearing is under way')
        .toContain('alUploads/log-too-old');
    await page.evaluate(() => /** @type {any} */ (window).__E2E.releaseCommits?.());
});
