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

// ── THE PRINT BUTTON PRINTS WHAT IS ON SCREEN (v23.27) ──────────────────────────────────────────
// The prepare used to un-hide every card the finder had filtered out, so a traveller looking at one
// country got the whole guide — 25 pages, at a station, before a trip. Opening a collapsed card is
// a rendering repair (the print engine drops a closed `details`); un-hiding a filtered one overrides
// a choice the reader made. The two are now separated, and this is the half that had no test.
test('the FIP print button prints the countries on screen, not all of them @print', async ({ page }) => {
    await page.goto('/fip-guide.html');
    await page.locator('#countrySearch').fill('Belgium');
    const hiddenBefore = await page.evaluate(() =>
        [...document.querySelectorAll('[id^="country-"]')].filter(c => c.hidden).length);
    expect(hiddenBefore, 'the filter has to have hidden something for this to mean anything')
        .toBeGreaterThan(10);

    await page.evaluate(() => { window.print = () => {}; });
    await page.locator('.btn-print').click();
    expect(await page.evaluate(() =>
        [...document.querySelectorAll('[id^="country-"]')].filter(c => c.hidden).length),
        'a filtered guide prints the filter').toBe(hiddenBefore);
    // …and what IS shown still reaches the paper opened, which is the repair this handler exists
    // for: a closed `details` prints as an empty bordered strip.
    expect(await page.evaluate(() => [...document.querySelectorAll('[id^="country-"]')]
        .filter(c => !c.hidden)
        .every(c => c.tagName !== 'DETAILS' || /** @type {HTMLDetailsElement} */ (c).open)),
        'every country still on screen is open for the printer').toBe(true);

    // And the button says which of the two it will do — the visible label cannot change (shared
    // header geometry), so the accessible name is where the scope has to live.
    // Derived from the DOM, not written down: the query matches whichever cards mention Belgium,
    // and a hardcoded number here would be a claim about the guide's prose.
    const shown = await page.evaluate(() =>
        [...document.querySelectorAll('[id^="country-"]')].filter(c => !c.hidden).length);
    await expect(page.locator('.btn-print'))
        .toHaveAttribute('aria-label', new RegExp(`the ${shown} countr(y|ies) shown`));

    // …and a SIGHTED reader is told too (v23.31). The accessible name above is announced on focus;
    // a traveller filtering to one country never focuses the button before pressing it, so until
    // now nothing on screen said the ⤓ PDF would follow the filter — which is the entire point of
    // the behaviour this test pins. The cue lives on the finder's own count line.
    await expect(page.locator('#countryCount')).toContainText('the PDF saves what is shown');

    await page.locator('#countryClear').click();
    await expect(page.locator('.btn-print')).toHaveAttribute('aria-label', /whole FIP guide/);
    // Unfiltered, the whole guide prints, which is what a PDF button is assumed to do — so the cue
    // goes away with the filter rather than stating the obvious.
    await expect(page.locator('#countryCount')).toBeHidden();
});

// ── AND THE RESTORE MAY NOT DEPEND ON `afterprint` EITHER (v23.27) ──────────────────────────────
// The prepare stopped trusting `beforeprint`; the restore was left trusting `afterprint`, which is
// the same event from the same engine. On the AirPrint route neither fires, so the guide stays
// expanded — printing becomes a way to permanently change the page. `visibilitychange` is the one
// signal every engine sends when the print sheet is dismissed.
test('the FIP guide is put back after a print that never fires afterprint @print', async ({ page }) => {
    await page.goto('/fip-guide.html');
    const closedBefore = await page.evaluate(() => document.querySelectorAll('details:not([open])').length);
    expect(closedBefore, 'the fixture needs collapsed countries').toBeGreaterThan(10);

    await page.evaluate(() => { window.print = () => {}; });
    await page.locator('.btn-print').click();
    expect(await page.evaluate(() => document.querySelectorAll('details:not([open])').length))
        .toBe(0);

    // No `afterprint` — that is the case under test. Only the visibility signal.
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(await page.evaluate(() => document.querySelectorAll('details:not([open])').length),
        'the countries the reader had collapsed must come back collapsed').toBe(closedBefore);
});

// ── THE DAILY HUDDLE IS NOT PRINTED ─────────────────────────────────────────────────────────────
// Owner decision (7 Sep 2026): the Huddle is read in the app, not on paper. Before this, the viewer
// had no print rules at all and clipped a 40-row day plan to 30 rows with nothing saying so — the
// hazard was never the styling, it was a sheet that looks complete and is not. The replacement has
// to be checked from BOTH sides: the Huddle must not reach the paper, AND the reader must not be
// silently handed the calendar instead, which would be the same surprise with a tidier finish.
test('an open Daily Huddle is not printed, and says so @print', async ({ page }) => {
    await seedSession(page);
    await page.goto('/index.html');
    await expect(page.locator('#huddleViewer')).toBeAttached();

    const opened = await page.evaluate(() => {
        const v = document.getElementById('huddleViewer');
        const body = v?.querySelector('#huddleViewerBody');
        if (!v || !body) return false;
        v.classList.add('visible', 'open');
        body.innerHTML = '<table>' + Array.from({ length: 40 },
            (_, i) => `<tr><td>Job ${i + 1}</td><td>Duty ${i + 1}</td></tr>`).join('') + '</table>';
        return true;
    });
    expect(opened, 'the Huddle viewer and its body must exist to test this').toBe(true);

    const seen = await inPrint(page, () => {
        const v = document.getElementById('huddleViewer');
        const rows = [...document.querySelectorAll('#huddleViewerBody tr')];
        const cal = document.querySelector('.container');
        // ::before carries the notice, so it is read from the computed style rather than the DOM.
        const notice = getComputedStyle(document.body, '::before').content || '';
        return {
            viewerH: Math.round(v.getBoundingClientRect().height),
            anyRowVisible: rows.some(r => r.getBoundingClientRect().height > 0),
            calendarVisible: !!cal && cal.getBoundingClientRect().height > 0,
            noticeMentionsHuddle: /Huddle/.test(notice),
        };
    });
    expect(seen.viewerH, 'the Huddle viewer has no height on paper').toBe(0);
    expect(seen.anyRowVisible, 'no row of the day plan reaches the paper').toBe(false);
    // The other half: the reader asked to print the Huddle, so they must not just get the month
    // grid with no explanation. Where `:has()` is unsupported this degrades to the calendar, which
    // is why the notice is asserted but the calendar being hidden is asserted alongside it.
    expect(seen.noticeMentionsHuddle, 'the sheet explains what happened').toBe(true);
    expect(seen.calendarVisible, 'the calendar is not silently substituted').toBe(false);
});

