/**
 * print.spec.js — PAPER IS A SEPARATE PRODUCT SURFACE, AND NOTHING WAS CHECKING IT.
 *
 * Every other e2e spec here asks what the app looks like on a screen. None of them can see the
 * print stylesheet at all, and the defects this suite pins were all of the same shape: the page
 * renders perfectly, no assertion fails, no axe rule fires, and the SHEET is wrong. Five shipped
 * that way and were found only by rendering PDFs and reading them back (external review + the
 * v23.20 audit):
 *
 *   · a pay estimate whose "Your Settings" heading stood over nothing
 *   · five surfaces composed for US Letter in a UK railway app
 *   · a guide printing a "← Back to calendar" website link
 *   · a 24-page reference that printed 8 pages on an engine that skips `beforeprint`
 *   · a Daily Huddle that stopped at row 30 of 40 with nothing saying so
 *
 * Four of those five are SILENT LOSSES — the sheet looks finished. That is the argument for
 * checking paper mechanically rather than trusting somebody to print one occasionally.
 *
 * WHAT IS ASSERTED, AND WHY IN THIS FORM. Page GEOMETRY is read from the generated PDF's own
 * MediaBox, because that is the one thing only a real print run knows. Everything else is measured
 * on the live DOM under `emulateMedia({ media: 'print' })`, which is both faster and more precise
 * about the CAUSE — a height of 0 names the rule that did it, where a missing word in extracted PDF
 * text could be a dozen things. No pdf-parsing dependency is added for that reason.
 *
 * CHROMIUM ONLY, deliberately and narrowly: `page.pdf()` exists in no other engine, so the two
 * geometry tests skip elsewhere. The print-media DOM tests run everywhere, which matters — WebKit
 * is the engine half this station reads on, and it is where the `beforeprint` assumption came from.
 */
import { test, expect } from './fixtures.js';
import { seedSession } from './helpers.js';

/** A4 portrait in points, to the nearest whole number: 595 × 842. Landscape is the transpose. */
const A4_W = 595, A4_H = 842;

/**
 * The page box the browser actually composed, straight out of the PDF's own MediaBox.
 * Regex rather than a parser: this is the only fact needed from the file, and a print suite should
 * not drag in a PDF library to learn it.
 * @param {import('@playwright/test').Page} page
 */
async function pageBox(page) {
    const buf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
    const m = /MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(buf.toString('latin1'));
    if (!m) throw new Error('no MediaBox in the generated PDF');
    return { w: Math.round(+m[1]), h: Math.round(+m[2]) };
}

/** @param {import('@playwright/test').Page} page @param {() => any} fn */
async function inPrint(page, fn) {
    await page.emulateMedia({ media: 'print' });
    try { return await page.evaluate(fn); } finally { await page.emulateMedia({ media: null }); }
}

// ── PAPER SIZE ──────────────────────────────────────────────────────────────────────────────────
// Without an `@page size` the browser picks its own default, and on a Chromium built for US locales
// that is LETTER — 216×279mm, six wider and eighteen shorter than A4. Every page break is then
// computed against a page that is not the sheet in the tray. Four of these five guides had no
// `@page` at all until v23.20, and the failure is invisible from the screen.
test.describe('every printable document states A4', () => {
    for (const guide of ['staff-guide', 'paycalc-guide', 'railcard-guide', 'rangers-guide', 'fip-guide']) {
        test(`${guide} prints A4 portrait @print`, async ({ page, browserName }) => {
            test.skip(browserName !== 'chromium', 'page.pdf() is Chromium-only');
            await page.goto(`/${guide}.html`);
            await expect(page.locator('h1, .page-header').first()).toBeVisible();
            expect(await pageBox(page)).toEqual({ w: A4_W, h: A4_H });
        });
    }
});

// ── THE ROSTER'S ORIENTATION FOLLOWS THE VIEW ───────────────────────────────────────────────────
// Landscape used to be installed by the About lightbox's Print button, so Ctrl+P, File → Print, the
// `p` shortcut and AirPrint all printed the seven-column week grid portrait. This drives NONE of
// those controls — it renders the page directly, which is what every one of them ends up doing —
// and the third leg is the one the old code could not guarantee, because removal depended on an
// `afterprint` iOS may never fire.
test('Team View owns its paper, and gives it back @print', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'page.pdf() is Chromium-only');
    await seedSession(page);
    await page.goto('/index.html');
    await expect(page.locator('#teamViewBtn')).toBeAttached();
    await page.waitForTimeout(1500);

    expect(await pageBox(page), 'month view prints portrait').toEqual({ w: A4_W, h: A4_H });

    // Synchronised on the paper rule rather than on the grid being VISIBLE: under the hermetic
    // Firebase stub the week table renders into a container the boot leaves hidden, which says
    // nothing about the subject here. The assertion is still the PDF's own page box.
    await page.evaluate(() => document.getElementById('teamViewBtn')?.click());
    await expect.poll(() => page.evaluate(() => !!document.getElementById('tvPrintPage')),
        { message: 'entering team view installs the landscape rule' }).toBe(true);
    expect(await pageBox(page), 'the week grid prints landscape').toEqual({ w: A4_H, h: A4_W });

    await page.evaluate(() => document.getElementById('teamViewBtn')?.click());
    await expect.poll(() => page.evaluate(() => !!document.getElementById('tvPrintPage')),
        { message: 'leaving team view removes it again' }).toBe(false);
    expect(await pageBox(page), 'leaving team view gives the portrait page back')
        .toEqual({ w: A4_W, h: A4_H });
});

// ── THE PAY ESTIMATE KEEPS ITS ASSUMPTIONS ──────────────────────────────────────────────────────
// `.collapsible-body` rests at `max-height: 0`, and the print block lifted that for the breakdown
// only — so a collapsed Settings card printed its heading and then nothing, over a take-home figure
// with no grade, rate, tax code or pension to check it against later.
//
// The collapsed state is what the app itself produces: `paycalc-settings.js` opens the card only
// for first-time users and closes it 2.5s after a save. This test therefore closes it explicitly,
// because a freshly seeded browser is a first-time user and would pass while every established
// member's sheet was blank — the exact reason the defect survived.
test('a collapsed Settings card still prints its values @print', async ({ page }) => {
    await seedSession(page);
    await page.addInitScript(() => {
        localStorage.setItem('myb_pc_ytd_notice_2_shown', '1');
        localStorage.setItem('myb_pc_ns_migrated', '1');
    });
    await page.goto('/paycalc.html');
    await expect(page.locator('#settingsCard')).toBeVisible();

    // Close it through the REAL control, and wait for the collapse to SETTLE.
    // The first version of this test did `classList.remove('open')` and measured at once — and
    // passed with the fix reverted, because `.collapsible-body` transitions `max-height` over
    // --dur-slower, so it was reading a frame at 1485px on the way down from 1800 rather than a
    // collapsed card. A test that measures an animation frame cannot see the state it guards.
    await page.locator('#settingsToggle .card-toggle-arrow').click();
    await expect.poll(() => page.evaluate(
        () => Math.round(document.getElementById('settingsBody').getBoundingClientRect().height)),
        { message: 'the card is actually collapsed on screen before print is asked about it' })
        .toBe(0);

    const h = await inPrint(page, () => {
        const b = document.getElementById('settingsBody');
        const grade = document.getElementById("gradeSelect");
        return { body: Math.round(b.getBoundingClientRect().height),
                 gradeVisible: !!(grade && grade.getBoundingClientRect().height > 0) };
    });
    expect(h.body, 'the Settings body has height on paper even when collapsed on screen')
        .toBeGreaterThan(100);
    expect(h.gradeVisible, 'the grade field itself reaches the paper').toBe(true);
});

// ── NAVIGATION IS NOT A DOCUMENT ────────────────────────────────────────────────────────────────
// `guide-shell.css` hides every guide's HEADER back arrow; the footer link is a per-guide element
// and railcard's was simply missed, printing 38px tall. Asserted across all five rather than the
// one that broke — a per-guide element is exactly the kind that gets added again.
test('no guide prints a website navigation link @print', async ({ page }) => {
    for (const guide of ['staff-guide', 'paycalc-guide', 'railcard-guide', 'rangers-guide', 'fip-guide']) {
        await page.goto(`/${guide}.html`);
        const visible = await inPrint(page, () =>
            [...document.querySelectorAll('a')]
                .filter(a => /back to (calendar|roster)/i.test(a.textContent || ''))
                .filter(a => a.getBoundingClientRect().height > 0)
                .map(a => a.textContent.trim()));
        expect(visible, `${guide} prints a back link`).toEqual([]);
    }
});

// ── PRINT PREPARATION MUST NOT DEPEND ON `beforeprint` ──────────────────────────────────────────
// FIP prepared its content only in a `beforeprint` handler, on an assumption `calendar-app.js`
// contradicts for the engine half this station reads on. Measured cost when it does not fire:
// 8 printed pages instead of 24. `window.print` is stubbed out here so ONLY the click path runs —
// which is the whole point, and is why this test does not need a real print dialog.
test('the FIP print button prepares without beforeprint @print', async ({ page }) => {
    await page.goto('/fip-guide.html');
    await expect(page.locator('.btn-print')).toBeVisible();
    const closedBefore = await page.evaluate(() => document.querySelectorAll('details:not([open])').length);
    expect(closedBefore, 'the fixture needs collapsed countries to be worth anything')
        .toBeGreaterThan(10);

    await page.evaluate(() => { window.print = () => {}; });
    await page.locator('.btn-print').click();
    expect(await page.evaluate(() => document.querySelectorAll('details:not([open])').length),
        'every country is open before the printer is reached').toBe(0);

    // IDEMPOTENCE, which is not a nicety: on every desktop browser BOTH routes now fire, and a
    // second snapshot would record every `details` as already open — after which restore leaves the
    // guide permanently expanded. Printing must never be a way to change the page.
    await page.evaluate(() => {
        window.dispatchEvent(new Event('beforeprint'));
        window.dispatchEvent(new Event('afterprint'));
    });
    expect(await page.evaluate(() => document.querySelectorAll('details:not([open])').length),
        'a second prepare must not destroy the restore snapshot').toBe(closedBefore);
});

// ── AN OPERATIONAL DOCUMENT PRINTS WHOLE ────────────────────────────────────────────────────────
// The Huddle viewer is `position: fixed; inset: 0` over a scrolling body, so it printed one
// viewport and stopped: 30 rows of a 40-row day plan, with nothing on the sheet to say the rest
// existed. The assertion is on the LAST row rather than a count, because that is the one a
// truncated sheet loses first and a reader can never miss.
test('an open Daily Huddle prints every row @print', async ({ page }) => {
    await seedSession(page);
    await page.goto('/index.html');
    await expect(page.locator('#huddleViewer')).toBeAttached();

    const res = await page.evaluate(() => {
        const v = document.getElementById('huddleViewer');
        const body = v?.querySelector('#huddleViewerBody');
        if (!v || !body) return null;
        v.classList.add('visible', 'open');
        body.innerHTML = '<table>' + Array.from({ length: 40 },
            (_, i) => `<tr><td>Job ${i + 1}</td><td>Duty ${i + 1}</td></tr>`).join('') + '</table>';
        return true;
    });
    expect(res, 'the Huddle viewer and its body must exist to test this').toBe(true);

    const seen = await inPrint(page, () => {
        const v = document.getElementById('huddleViewer');
        const last = [...document.querySelectorAll('#huddleViewerBody tr')].pop();
        const close = document.getElementById('huddleViewerClose');
        const vb = v.getBoundingClientRect();
        const lb = last.getBoundingClientRect();
        return { viewerH: Math.round(vb.height),
                 lastRowBottom: Math.round(lb.bottom),
                 lastRowHasHeight: lb.height > 0,
                 closePrints: !!(close && close.getBoundingClientRect().height > 0) };
    });
    expect(seen.lastRowHasHeight, 'the 40th row is laid out at all').toBe(true);
    expect(seen.lastRowBottom, 'the last row sits inside the printed flow, not past a clip')
        .toBeLessThanOrEqual(seen.viewerH + 1);
    expect(seen.closePrints, 'the ✕ close control must not print').toBe(false);
});
