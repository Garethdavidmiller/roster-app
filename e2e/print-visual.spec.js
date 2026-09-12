/**
 * print-visual.spec.js — WHAT THE FIRST SHEET ACTUALLY LOOKS LIKE.
 *
 * ── WHY A SEPARATE SPEC, AND WHY THE PDF ────────────────────────────────────────────────────────
 *
 * `print.spec.js` proves print BEHAVIOUR — the page box is A4, a collapsed card still prints its
 * values, a guide prints no website link. `visual.spec.js` proves SCREEN composition. Neither can
 * see what a member takes off the printer, and the v23.20 print review found five defects of
 * exactly that shape: the page renders perfectly, no assertion fails, and the sheet is wrong.
 *
 * The obvious cheap approach is `emulateMedia({ media: 'print' })` and a viewport screenshot. It is
 * not enough, and the reason is the whole point of this file: **emulateMedia applies the print
 * STYLESHEET but does not paginate.** No `@page` margin, no page break, no first-sheet boundary. It
 * would lock the CSS and miss the thing the ROADMAP row actually names — *the ones where a page
 * break changes meaning*. A baseline that cannot see a page break is not a print baseline.
 *
 * So this renders the REAL PDF through `page.pdf()` — the same call `print.spec.js` reads its
 * MediaBox from — and rasterises **page 1** with `pdftoppm`. What is compared is a picture of
 * paper: margins applied, content clipped at the sheet boundary, exactly what comes out.
 *
 * ── WHY ONLY TWO SURFACES, AND WHY PAGE ONE ─────────────────────────────────────────────────────
 *
 * Owner decision, 12 Sep 2026, answering the question the ROADMAP row said only they could:
 * **Calendar and Team View, first page only.** Those are the two roster surfaces, and the two where
 * a break genuinely changes meaning — a month split mid-week, or a 44-name team table that loses
 * its header row. Pixel-locking every printable surface would be cost without a reader, which that
 * row refuses on purpose; the app's own evidence agreed, since Admin — one of the row's five
 * candidates — has no print control at all.
 *
 * First page rather than the whole sheet, also deliberate. Every defect the print review found
 * lived on page one (a heading over nothing, US Letter composition, a stray website link, the
 * landscape rule). A full-document baseline drifts on any content change anywhere, and this repo
 * already records what happens to a baseline that drifts often: it stops being read. Page count is
 * asserted separately below, which catches the one page-N regression that mattered — a 24-page
 * guide printing 8 — without pixel-locking 24 sheets to do it.
 *
 * ── THE RASTERISER IS OPTIONAL, AND ITS ABSENCE IS LOUD ─────────────────────────────────────────
 *
 * `pdftoppm` (poppler) is not a Node dependency and cannot be assumed. Its absence SKIPS with a
 * message naming what went unchecked — never a silent pass, which is the failure this repo keeps
 * writing down. `page.pdf()` is Chromium-only, so the whole file skips elsewhere; that is the same
 * narrow exception `print.spec.js` already takes, and it is stated rather than implied.
 *
 * ── DETERMINISM ─────────────────────────────────────────────────────────────────────────────────
 *
 * The same levers as `visual.spec.js`, for the same reason: a pinned clock (so the month and the
 * pay period do not move), a stubbed Firebase (so every read is empty), a fixed member, one-time
 * overlays pre-dismissed, and fonts awaited before the PDF is generated. `-r 96` fixes the raster
 * at CSS resolution so the PNG is the sheet at 1:1 and does not change size with a poppler default.
 */
import { test, expect } from './fixtures.js';
import { seedSession } from './helpers.js';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** The clock `visual.spec.js` pins, so a printed month is the same month every run. */
const FIXED_TIME = new Date('2026-07-15T09:00:00Z');

/** Is poppler's rasteriser on this machine? Probed once. */
const RASTERISER = (() => {
    try { execFileSync('pdftoppm', ['-v'], { stdio: 'ignore' }); return true; } catch { return false; }
})();

/**
 * Page 1 of the PDF this page would print, as a PNG buffer at 1:1 CSS resolution.
 * @param {import('@playwright/test').Page} page
 */
function rasterisePageOne(/** @type {Buffer} */ pdf) {
    const dir = mkdtempSync(join(tmpdir(), 'print-visual-'));
    const src = join(dir, 'sheet.pdf');
    writeFileSync(src, pdf);
    // -r 96: CSS pixels, so the PNG is the sheet at 1:1 and poppler's own default cannot move it.
    // -f/-l 1: page one only. -png: no intermediate format.
    execFileSync('pdftoppm', ['-png', '-r', '96', '-f', '1', '-l', '1', src, join(dir, 'page')]);
    const out = readdirSync(dir).find(f => f.startsWith('page') && f.endsWith('.png'));
    if (!out) throw new Error('pdftoppm produced no PNG');
    return readFileSync(join(dir, out));
}

/** How many sheets this document is. A regex, not a parser — `print.spec.js` makes the same call
 *  about its MediaBox, and for the same reason: one fact does not justify a PDF library. */
function pageCount(/** @type {Buffer} */ pdf) {
    const s = pdf.toString('latin1');
    const counts = [...s.matchAll(/\/Count\s+(\d+)/g)].map(m => +m[1]);
    if (counts.length) return Math.max(...counts);
    return (s.match(/\/Type\s*\/Page[^s]/g) || []).length;
}

/** Pre-dismiss every one-time overlay, exactly as the screen baselines do. */
async function dismissOneTimeOverlays(page) {
    await page.addInitScript(() => {
        const flags = {
            'myb_notice_al_booking_2026_done': '1',
            'myb_notif_prompt_done': '1',
            'myb_links_welcome_seen': '1',
        };
        for (const [k, v] of Object.entries(flags)) {
            try { localStorage.setItem(k, v); } catch { /* iOS private mode — ignore */ }
        }
    });
}

async function prep(page) {
    await page.clock.setFixedTime(FIXED_TIME);
    await page.setViewportSize({ width: 1280, height: 900 });
    await seedSession(page, 'G. Miller');
    // The Calendar needs a restorable Firebase identity as well as a local session since v20.12 —
    // without it every capture here would be the staff-PIN card rather than a roster.
    await page.addInitScript(() => { window.__E2E = Object.assign(window.__E2E || {}, { authUser: true }); });
    await dismissOneTimeOverlays(page);
}

async function settle(page, ready) {
    await expect(page.locator(ready).first()).toBeVisible();
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
}

test.describe('the first printed sheet @print', () => {
    test.skip(({ browserName }) => browserName !== 'chromium', 'page.pdf() is Chromium-only');

    test('calendar — page 1 of the printed month', async ({ page }) => {
        await prep(page);
        await page.goto('/index.html');
        await settle(page, '.calendar-day');
        const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });

        // A month is one sheet. If this ever becomes two, the grid has outgrown the page and the
        // second sheet holds a fragment nobody designed — worth failing over even though the
        // baseline below only sees page one.
        expect(pageCount(pdf), 'a printed month must fit one sheet').toBe(1);

        test.skip(!RASTERISER, 'pdftoppm (poppler) is not installed — the printed SHEET was not '
            + 'compared against its baseline on this run. Only the page count above was checked. '
            + 'Install poppler-utils to run this properly.');
        expect(rasterisePageOne(pdf)).toMatchSnapshot('print-calendar-page1.png');
    });

    test('team view — page 1, and it is LANDSCAPE', async ({ page }) => {
        await prep(page);
        await page.goto('/index.html');
        await settle(page, '.calendar-day');
        await page.locator('#teamViewBtn').click();
        await settle(page, '.team-week-text');
        await page.evaluate(() => new Promise(r => setTimeout(r, 300)));
        const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });

        // The v23.20 rule, in the one place that can see it: the landscape `@page` is injected by
        // the MODE, so it must hold for a print reached by any route, not just the button. A
        // seven-column grid of shift times on portrait paper is the defect this replaced.
        const m = /MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(pdf.toString('latin1'));
        expect(m, 'no MediaBox in the generated PDF').toBeTruthy();
        expect(Math.round(+m[1]), 'Team View prints landscape').toBeGreaterThan(Math.round(+m[2]));

        test.skip(!RASTERISER, 'pdftoppm (poppler) is not installed — the printed SHEET was not '
            + 'compared against its baseline on this run. Only the landscape page box above was '
            + 'checked. Install poppler-utils to run this properly.');
        expect(rasterisePageOne(pdf)).toMatchSnapshot('print-team-view-page1.png');
    });
});
