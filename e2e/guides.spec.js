/**
 * guides.spec.js — the guide pages: the FIP guide and the shared guide shell.
 *
 * Split out of pages.spec.js on 3 Nov 2026, test for test and unchanged: the tests that span
 * pages, and the shared drawer, dialogs and sheets, stay there.
 */
import { readFileSync } from 'node:fs';
import { test, expect } from './fixtures.js';
import { collectFatalErrors, isTouchProject, scaleText, seedMemberSession } from './helpers.js';
import { GUIDE_PAGES } from '../scripts/app-pages.mjs';

// ── FIP GUIDE (fip-guide.html) — jump-to-open + malformed-hash safety ──────────────

test('fip: a country jump-link opens that country section (C1)', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.goto('/fip-guide.html#country-fr');   // deep-link straight to France
    // fip-guide.js opens the target <details> on load; without it the row stays collapsed.
    await expect(page.locator('#country-fr')).toHaveAttribute('open', '');
    // And an in-page jump (hashchange) opens another one.
    await page.locator('.country-jump a[href="#country-be"]').click();
    await expect(page.locator('#country-be')).toHaveAttribute('open', '');
    expect(errors, `fatal errors: ${errors.join('; ')}`).toEqual([]);
});

// ── A DEEP LINK LANDS CLEAR OF THE STICKY STACK (whole-app review, 10 Nov 2026) ────────────────
// Every drawer search result is a deep link into a guide. The browser scrolls to the fragment as
// soon as the target is laid out, with the stylesheets' fallback scroll-margin — shorter than the
// real header + chip bar on a phone, whose subtitle wraps — and stops re-applying it once the page
// has loaded. The scripts measure the real stack only on `document.fonts.ready` and the header's
// ResizeObserver, and on a phone serving everything from its cache the load finishes first: a
// result opened with its own heading under the chip bar (Rangers 48px, Railcard 28px, the FIP
// booking table and ferry cards 21px, at 375px).
//
// On a fast local server that order is a RACE, which the old code won most of the time — so these
// tests FORCE the phone's order. An init script holds both measurement triggers until the test
// releases them, after `load`. The page's own code is untouched; only WHEN the platform answers it
// changes.
/** @param {import('@playwright/test').Page} page */
async function holdGuideMeasurement(page) {
    await page.addInitScript(() => {
        /** @type {() => void} */
        let release = () => {};
        const released = new Promise(resolve => { release = () => resolve(undefined); });
        /** @type {any} */ (window).__releaseGuideMeasurement = () => release();
        const RealObserver = window.ResizeObserver;
        window.ResizeObserver = class extends RealObserver {
            /** @param {ResizeObserverCallback} callback */
            constructor(callback) {
                super((entries, observer) => { released.then(() => callback(entries, observer)); });
            }
        };
        // `ready` is an accessor on the FontFaceSet prototype, an interface Chromium does not expose
        // by name — so walk to it from the instance rather than naming it.
        /** @type {PropertyDescriptor|undefined} */
        let ready;
        for (let proto = Object.getPrototypeOf(document.fonts); proto && !ready; proto = Object.getPrototypeOf(proto)) {
            ready = Object.getOwnPropertyDescriptor(proto, 'ready');
        }
        const realReady = /** @type {PropertyDescriptor} */ (ready);
        Object.defineProperty(document.fonts, 'ready', {
            configurable: true,
            get() { return released.then(() => realReady.get?.call(document.fonts)); },
        });
    });
}
/** Two frames and a beat: let a measurement, and any scroll it starts, finish. @param {import('@playwright/test').Page} page */
async function settleFrames(page) {
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 200)))));
}
/** Open a guide at a fragment with its measurement held, and wait for the browser's own landing. */
async function landHeld(/** @type {import('@playwright/test').Page} */ page, /** @type {string} */ url) {
    await page.goto(url);   // resolves on `load` — after which the browser no longer re-lands the fragment
    await page.waitForFunction(() => document.fonts.status === 'loaded');
    await settleFrames(page);
}
/**
 * Move the page 30px as its reader would, with a gesture the landing ends on: a wheel at a desk, a touch on a
 * phone, where a reader has no wheel (and mobile WebKit has no `mouse.wheel` at all). The touch lands on the
 * header's title, which has nothing to activate; the scroll that follows is the distance it moved the page.
 * @param {import('@playwright/test').Page} page @param {import('@playwright/test').TestInfo} info
 */
async function nudgeAsReader(page, info) {
    if (isTouchProject(info)) {
        const title = /** @type {{ x: number, y: number, width: number, height: number }} */ (
            await page.locator('.page-header h1').boundingBox());
        await page.touchscreen.tap(title.x + title.width / 2, title.y + title.height / 2);
        await page.evaluate(() => window.scrollBy(0, 30));
    } else {
        await page.mouse.move(180, 500);
        await page.mouse.wheel(0, 30);
    }
}
/** @param {import('@playwright/test').Page} page @param {string} id */
function landing(page, id) {
    return page.evaluate((target) => ({
        top: Math.round(document.getElementById(target)?.getBoundingClientRect().top ?? -1),
        barBottom: Math.round(document.querySelector('.chip-bar')?.getBoundingClientRect().bottom ?? -1),
    }), id);
}

for (const [guide, id] of /** @type {Array<[string, string]>} */ ([
    ['rangers-guide', 'rr-thames'],
    ['railcard-guide', 'rc-senior'],
    ['fip-guide', 'booking-table'],           // not a section label or a country card
    ['fip-guide', 'ferry-stena-irish-sea'],   // nor this
])) {
    test(`guides: a deep link to ${guide}#${id} lands below the header and chip bar`, async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 740 });
        await holdGuideMeasurement(page);
        await landHeld(page, `/${guide}.html#${id}`);
        await page.evaluate(() => /** @type {any} */ (window).__releaseGuideMeasurement());
        await settleFrames(page);
        const geo = await landing(page, id);
        expect(geo.barBottom, 'the chip bar is where this test looks for it').toBeGreaterThan(0);
        expect(geo.top, `#${id} starts under the sticky stack (top ${geo.top}px, chip bar ends ${geo.barBottom}px)`)
            .toBeGreaterThanOrEqual(geo.barBottom);
    });
}

// The other half: the re-landing is for a page still LANDING. A reader who has already moved the
// page is left where they put it, and so is a reload, which restores the reader's own position
// rather than the fragment. The nudge is small on purpose — the target stays inside the band where
// a re-land would act, so only the two guards stand between the reader and a jump.
test('guides: a deep link does not pull back a reader who has moved, or a reload', async ({ page }, info) => {
    await page.setViewportSize({ width: 375, height: 740 });
    await holdGuideMeasurement(page);
    await landHeld(page, '/railcard-guide.html#rc-senior');
    await nudgeAsReader(page, info);
    await settleFrames(page);
    const moved = await page.evaluate(() => Math.round(window.scrollY));
    const { top, barBottom } = await landing(page, 'rc-senior');
    expect(top, 'the nudge leaves the card inside the band a re-land would act on').toBeLessThan(barBottom);
    await page.evaluate(() => /** @type {any} */ (window).__releaseGuideMeasurement());
    await settleFrames(page);
    expect(await page.evaluate(() => Math.round(window.scrollY)), 'the measurement moved a reader who had scrolled').toBe(moved);

    await page.reload();
    await page.waitForFunction(() => document.fonts.status === 'loaded');
    await settleFrames(page);
    const restored = await page.evaluate(() => Math.round(window.scrollY));
    await page.evaluate(() => /** @type {any} */ (window).__releaseGuideMeasurement());
    await settleFrames(page);
    expect(await page.evaluate(() => Math.round(window.scrollY)), 'the measurement moved a reloaded page off its restored position').toBe(restored);
});

// A scroll that comes with no touch, click, wheel or key — a screen reader moving through the page,
// a drag on the scrollbar — ends nothing, so what leaves it alone is that the target is no longer
// under the sticky stack.
test('guides: a deep link leaves alone a page scrolled away without a touch or a key', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 740 });
    await holdGuideMeasurement(page);
    await landHeld(page, '/rangers-guide.html#rr-thames');
    await page.evaluate(() => window.scrollBy(0, 400));
    await settleFrames(page);
    const moved = await page.evaluate(() => Math.round(window.scrollY));
    await page.evaluate(() => /** @type {any} */ (window).__releaseGuideMeasurement());
    await settleFrames(page);
    expect(await page.evaluate(() => Math.round(window.scrollY)), 'the measurement pulled the page back to the fragment').toBe(moved);
});

// ── …AND ON THE TWO DOCUMENT GUIDES, WHICH HAVE NO CHIP BAR (whole-app fix, 10 Nov 2026) ─────────────────
// Their one sticky element is the header, and no stylesheet knows its height: with the phone's text one
// step up the title wraps, and a search result opened its heading under the header — 25px at 375px,
// 60px at 1.3×. The text is scaled as Android scales it (every used size multiplied, each read before
// any is written) at DOMContentLoaded, so it is in place before the browser lands, and the measurement
// is held until after `load`, the phone's order, as above. guide-back.js does the measuring.
/** @param {import('@playwright/test').Page} page @param {number} k */
async function scaleTextBeforeLanding(page, k) {
    await page.addInitScript((mult) => document.addEventListener('DOMContentLoaded', () => {
        const els = /** @type {HTMLElement[]} */ ([...document.querySelectorAll('*')]);
        const px = els.map(el => parseFloat(getComputedStyle(el).fontSize));
        els.forEach((el, i) => { if (px[i]) el.style.fontSize = `${px[i] * mult}px`; });
    }), k);
}
/** @param {import('@playwright/test').Page} page @param {string} id */
function underHeader(page, id) {
    return page.evaluate((target) => {
        const top = /** @type {HTMLElement} */ (document.getElementById(target)).getBoundingClientRect().top;
        const hdr = /** @type {HTMLElement} */ (document.querySelector('.page-header')).getBoundingClientRect().bottom;
        return { top: Math.round(top), hdr: Math.round(hdr) };
    }, id);
}

// THE WIDTH IS PART OF THE PREMISE. A deep link that lands under the header needs a header taller than the
// stylesheet's 90px, and at one text step up that is the title wrapping — which "📘 Staff & Admin Guide" does at
// 375px by 5px, a margin the machine's own emoji font decides: on CI's runner it stayed on one line, the header
// was 85px, and the test had nothing to test (10 Nov 2026). At 360px, a real Android width still on the 90px
// fallback, it wraps by 20px here; the Pay Calculator Guide's title wraps at 375px by 13px, and did on CI.
const STAFF_GUIDE_ONE_STEP_UP = 360;
for (const [guide, id, k, width] of /** @type {Array<[string, string, number, number]>} */ ([
    ['staff-guide', 'sg-change-a-shift', 1.15, STAFF_GUIDE_ONE_STEP_UP],
    ['paycalc-guide', 'pg-holiday-pay-premium-hpp', 1.15, 375],
    ['staff-guide', 'sg-sundays', 1.3, 375],
])) {
    test(`guides: a deep link to ${guide}#${id} lands below the header with the text at ${k}×`, async ({ page }) => {
        await page.setViewportSize({ width, height: 740 });
        await holdGuideMeasurement(page);
        await scaleTextBeforeLanding(page, k);
        await landHeld(page, `/${guide}.html#${id}`);
        const landed = await underHeader(page, id);
        expect(landed.top, 'premise: the browser\'s own landing, on the stylesheet\'s fallback, is under the header').toBeLessThan(landed.hdr);
        await page.evaluate(() => /** @type {any} */ (window).__releaseGuideMeasurement());
        await settleFrames(page);
        const geo = await underHeader(page, id);
        expect(geo.top, `#${id} starts under the header (top ${geo.top}px, header ends ${geo.hdr}px)`).toBeGreaterThanOrEqual(geo.hdr);
        // …and an in-page jump made later keeps the same clearance: it is the measured margin that holds it.
        await page.evaluate(() => { location.hash = ''; window.scrollTo(0, 0); });
        await page.evaluate((t) => { location.hash = t; }, id);
        await settleFrames(page);
        const jumped = await underHeader(page, id);
        expect(jumped.top, 'an in-page jump lands under the header').toBeGreaterThanOrEqual(jumped.hdr);
    });
}

// The two guards, on the document guides too: a reader who has moved, and a reload, are left where they are.
test('guides: on a document guide a deep link does not pull back a reader who has moved, or a reload', async ({ page }, info) => {
    // At the width where the title wraps by more than a font's difference (STAFF_GUIDE_ONE_STEP_UP): WebKit's
    // reload lands on the fragment again, inside the band only while the header is taller than the 90px fallback.
    await page.setViewportSize({ width: STAFF_GUIDE_ONE_STEP_UP, height: 740 });
    await holdGuideMeasurement(page);
    await scaleTextBeforeLanding(page, 1.15);
    await landHeld(page, '/staff-guide.html#sg-change-a-shift');
    await nudgeAsReader(page, info);
    await settleFrames(page);
    const moved = await page.evaluate(() => Math.round(window.scrollY));
    const { top, hdr } = await underHeader(page, 'sg-change-a-shift');
    expect(top, 'the nudge leaves the heading inside the band a re-land would act on').toBeLessThan(hdr);
    expect(top, 'and still on the screen').toBeGreaterThanOrEqual(0);
    await page.evaluate(() => /** @type {any} */ (window).__releaseGuideMeasurement());
    await settleFrames(page);
    expect(await page.evaluate(() => Math.round(window.scrollY)), 'the measurement moved a reader who had scrolled').toBe(moved);

    await page.reload();
    await page.waitForFunction(() => document.fonts.status === 'loaded');
    await settleFrames(page);
    const restored = await page.evaluate(() => Math.round(window.scrollY));
    const back = await underHeader(page, 'sg-change-a-shift');
    expect(back.top, 'premise: the reload restored a position inside the band').toBeLessThan(back.hdr);
    await page.evaluate(() => /** @type {any} */ (window).__releaseGuideMeasurement());
    await settleFrames(page);
    expect(await page.evaluate(() => Math.round(window.scrollY)), 'the measurement moved a reloaded page off its restored position').toBe(restored);
});

test('guides: on a document guide a deep link leaves alone a page scrolled away without a touch or a key', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 740 });
    await holdGuideMeasurement(page);
    await scaleTextBeforeLanding(page, 1.15);
    await landHeld(page, '/paycalc-guide.html#pg-holiday-pay-premium-hpp');
    await page.evaluate(() => window.scrollBy(0, 400));
    await settleFrames(page);
    const moved = await page.evaluate(() => Math.round(window.scrollY));
    await page.evaluate(() => /** @type {any} */ (window).__releaseGuideMeasurement());
    await settleFrames(page);
    expect(await page.evaluate(() => Math.round(window.scrollY)), 'the measurement pulled the page back to the fragment').toBe(moved);
});

// The landing ENDS once the page has loaded and measured: the header still re-measures afterwards (a font swap, a
// rotation), but that only moves the margins, never the reader.
test('guides: on a document guide, once the page has landed, a later change to the header does not move the reader', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 740 });
    await holdGuideMeasurement(page);
    await scaleTextBeforeLanding(page, 1.15);
    await landHeld(page, '/staff-guide.html#sg-change-a-shift');
    await page.evaluate(() => /** @type {any} */ (window).__releaseGuideMeasurement());
    await settleFrames(page);
    await page.evaluate(() => window.scrollBy(0, 40));   // no touch and no key: the heading goes back under the header
    await settleFrames(page);
    const { top, hdr } = await underHeader(page, 'sg-change-a-shift');
    expect(top, 'premise: the heading is inside the band a re-land would act on').toBeLessThan(hdr);
    expect(top, 'and still on the screen').toBeGreaterThanOrEqual(0);
    // The header is in the flow, so growing it moves the page under it, and the browser's scroll anchoring then
    // keeps what is on screen where it was: the reader's view is the heading's place on the screen, not scrollY.
    await page.evaluate(() => { /** @type {HTMLElement} */ (document.querySelector('.page-header h1')).style.fontSize = '24px'; });
    await settleFrames(page);
    const after = await underHeader(page, 'sg-change-a-shift');
    expect(after.hdr, 'premise: the header grew').toBeGreaterThan(hdr);
    expect(Math.abs(after.top - top), `a header change after the landing moved the reader (the heading went from ${top}px to ${after.top}px)`).toBeLessThanOrEqual(2);
});

// guide-back.js measures the HEADER alone, which on a chip-bar guide is short of the sticky stack by the whole bar —
// so it must leave those three to their own scripts. Today's script order would hide a lapse (the page's script
// writes last), so every margin WRITTEN is recorded, not just the one that ends up on the card.
test('guides: on a chip-bar guide, every scroll margin written clears the header and the chip bar', async ({ page }) => {
    await page.addInitScript(() => {
        /** @type {number[]} */
        const seen = [];
        /** @type {any} */ (window).__marginsWritten = seen;
        const read = (/** @type {string|null} */ style) => {
            const m = /scroll-margin-top:\s*([\d.]+)px/.exec(style || '');
            if (m) seen.push(parseFloat(m[1]));
        };
        new MutationObserver(records => records.forEach(r => {
            const el = /** @type {HTMLElement} */ (r.target);
            if (!el.id || !el.closest('main')) return;
            read(r.oldValue);
            read(el.getAttribute('style'));
        })).observe(document, { subtree: true, attributes: true, attributeFilter: ['style'], attributeOldValue: true });
    });
    for (const guide of ['railcard-guide', 'rangers-guide', 'fip-guide']) {
        await page.goto(`/${guide}.html`);
        await page.waitForFunction(() => document.fonts.status === 'loaded');
        await settleFrames(page);
        const m = await page.evaluate(() => ({
            written: /** @type {number[]} */ (/** @type {any} */ (window).__marginsWritten),
            stack: /** @type {HTMLElement} */ (document.querySelector('.page-header')).offsetHeight
                + /** @type {HTMLElement} */ (document.querySelector('.chip-bar')).offsetHeight,
        }));
        expect(m.written.length, `premise: ${guide} measured its stack`).toBeGreaterThan(0);
        expect(Math.min(...m.written), `${guide}: a margin was written that leaves a card under the chip bar (stack ${m.stack}px)`)
            .toBeGreaterThanOrEqual(m.stack);
    }
});

test('fip: a malformed hash does not throw (safeDecode)', async ({ page }) => {
    const errors = collectFatalErrors(page);
    // A lone "%" is an invalid percent-escape — decodeURIComponent would throw uncaught without the guard.
    await page.goto('/fip-guide.html#%');
    // Page still renders (the jump bar exists) and nothing crashed.
    await expect(page.locator('.country-jump')).toBeVisible();
    expect(errors, `fatal errors: ${errors.join('; ')}`).toEqual([]);
});

// Country finder (v17.64): search filters the country cards + A–Z chips; clear + no-match + popular.
test('fip: the country finder filters cards, shows a no-match, and clears', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.goto('/fip-guide.html');
    const search = page.locator('#countrySearch');
    await expect(search).toBeVisible();
    // On an empty field the clear ✕ and the count are hidden (regression guard: an author `display`
    // rule can silently override the `hidden` attribute).
    await expect(page.locator('#countryClear')).toBeHidden();
    await expect(page.locator('#countryCount')).toBeHidden();

    // Filter to Spain: Spain stays, an unrelated country (Norway) is hidden, count + clear appear.
    await search.fill('spain');
    await expect(page.locator('#country-es')).toBeVisible();
    await expect(page.locator('#country-no')).toBeHidden();
    // Counted from the DOM, never written down. The literal 25 outlived the guide by one release:
    // the v20.25 country pass took it to 32 and this assertion failed on correct behaviour.
    const totalCountries = await page.locator('[id^="country-"]').count();
    await expect(page.locator('#countryCount')).toContainText(`of ${totalCountries} countries`);
    await expect(page.locator('#countryClear')).toBeVisible();
    // The A–Z chip for a hidden country is hidden too (kept in lockstep with its card).
    await expect(page.locator('.country-jump a[href="#country-no"]')).toBeHidden();

    // Gibberish → no-match message; every card hidden.
    await search.fill('qwertyzzz');
    await expect(page.locator('#countryNoMatch')).toBeVisible();
    await expect(page.locator('#country-es')).toBeHidden();

    // Clear button resets everything.
    await page.locator('#countryClear').click();
    await expect(page.locator('#country-no')).toBeVisible();
    await expect(page.locator('#countryNoMatch')).toBeHidden();
    await expect(search).toHaveValue('');
    expect(errors, `fatal errors: ${errors.join('; ')}`).toEqual([]);
});

// Whole-app review, Oct 2026: the finder only lower-cased, so an operator typed on a UK keyboard
// ("obb" for ÖBB, "krakow" for Kraków) found nothing, and "cie" matched inside "Société".
test('fip: the country finder folds accents and matches the start of a word', async ({ page }) => {
    await page.goto('/fip-guide.html');
    const search = page.locator('#countrySearch');
    await search.fill('obb');
    await expect(page.locator('#country-at')).toBeVisible();
    await expect(page.locator('#countryNoMatch')).toBeHidden();
    await search.fill('cie');
    await expect(page.locator('#country-ie')).toBeVisible();
    await expect(page.locator('#country-ch'), 'no longer found inside "Société"').toBeHidden();
    await search.fill('ÖBB');
    await expect(page.locator('#country-at'), 'the accented spelling still works').toBeVisible();
    // A stroke is part of its letter, so NFKD leaves Ł and ø whole (Nov 2026): these found nothing.
    await search.fill('lodz');
    await expect(page.locator('#country-pl'), '"lodz" finds Łódź').toBeVisible();
    await search.fill('kobenhavn');
    await expect(page.locator('#country-dk'), '"kobenhavn" finds København').toBeVisible();
});

// Whole-app review, Nov 2026: the booking steps say "see Czechia and Slovakia", and typing "Czechia"
// into the finder just below them answered "No countries or operators match" — the card was titled
// "Czech Republic", and the finder matches the start of a word. So every country the page's own
// booking table names must find a card TITLED with that name, which is what a reader is looking at.
// And a miss says what the finder covers: Eurostar and the ferries are sections of their own.
test('fip: the finder finds every country by the name the booking table gives it', async ({ page }) => {
    await page.goto('/fip-guide.html');
    const names = (await page.locator('#booking-table [role="rowheader"]').allTextContents()).map(n => n.trim());
    expect(names.length, 'the booking table is where this test reads the names').toBeGreaterThan(10);
    const search = page.locator('#countrySearch');
    for (const name of names) {
        await search.fill(name);
        const titles = await page.locator('[id^="country-"]:not([hidden]) :is(summary, .not-fip-name)').allTextContents();
        expect(titles.some(t => t.includes(name)),
            `"${name}" finds no card titled with it — the finder shows: ${titles.map(t => t.trim()).join(' | ') || 'nothing'}`).toBe(true);
    }
    // The card keeps the name a reader may still type.
    await search.fill('czech republic');
    await expect(page.locator('#country-cz')).toBeVisible();
    await search.fill('Stena');
    await expect(page.locator('#countryNoMatch')).toContainText('No country card matches');
    await expect(page.locator('#countryNoMatch')).toContainText('Ferries');
});

test('fip: the section chip-bar jumps to a section and marks it current', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.goto('/fip-guide.html');
    const chip = page.locator('.chip-bar .chip[data-target="sec-mistakes"]');
    await expect(chip).toBeVisible();
    await chip.click();
    await expect(page.locator('#sec-mistakes')).toBeInViewport();
    await expect(chip).toHaveAttribute('aria-current', 'true');
    // Clicking a different chip moves the current marker.
    const other = page.locator('.chip-bar .chip[data-target="sec-booking"]');
    await other.click();
    await expect(other).toHaveAttribute('aria-current', 'true');
    await expect(chip).not.toHaveAttribute('aria-current', 'true');
    expect(errors, `fatal errors: ${errors.join('; ')}`).toEqual([]);
});

// A CHOSEN CHIP'S WORDS EASE WITH ITS FILL (whole-app review, Nov 2026). Choosing a section turns its chip navy with
// white words, and the chip eased only its fill: for part of the 150ms the words were white on a still-white chip (and
// navy on a still-navy one going back). The axe scan waits out transitions, so it cannot see this — frozen here a
// tenth of the way into the change, where the words must still be told from the fill they sit on.
test('guides: a section chip\'s label stays readable while the chip changes colour', async ({ page }) => {
    await page.goto('/railcard-guide.html');
    const ratio = await page.locator('.chip-bar .chip').nth(1).evaluate(el => {
        document.querySelectorAll('.chip[aria-current]').forEach(c => c.removeAttribute('aria-current'));
        void getComputedStyle(el).color;          // the resting style, settled
        el.setAttribute('aria-current', 'true');  // what the page's script does on a tap
        void getComputedStyle(el).color;          // …which starts the transitions
        for (const a of el.getAnimations()) { a.pause(); a.currentTime = 15; }
        const ctx = /** @type {CanvasRenderingContext2D} */ (document.createElement('canvas').getContext('2d', { willReadFrequently: true }));
        /** @param {string} c */
        const rgb = (c) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = c; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3); };
        /** @param {number[]} v */
        const lum = (v) => { const [r, g, b] = v.map(x => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
        const cs = getComputedStyle(el);
        const [hi, lo] = [lum(rgb(cs.color)), lum(rgb(cs.backgroundColor))].sort((a, b) => b - a);
        return (hi + 0.05) / (lo + 0.05);
    });
    expect(ratio, `15ms into being chosen, the chip's label is ${ratio.toFixed(2)}:1 on its fill`).toBeGreaterThanOrEqual(4.5);
});

test('fip: scrollspy marks the chip for the section scrolled into view', async ({ page }) => {
    await page.goto('/fip-guide.html');
    // No sleep after each scroll (test audit, 7 Nov 2026 — three 350ms waits): each assertion WAITS
    // for its chip to become current, and every step moves the marker somewhere it was not, so none
    // can pass on the state the scroll before it left behind.
    // A mid-page section scrolled under the sticky stack becomes current.
    await page.evaluate(() => document.getElementById('sec-ferries').scrollIntoView({ block: 'start' }));
    await expect(page.locator('.chip[data-target="sec-ferries"]')).toHaveAttribute('aria-current', 'true');
    // At the very bottom, the last chip (Apply) wins even if its short section never reached the line.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect(page.locator('.chip[data-target="sec-apply"]')).toHaveAttribute('aria-current', 'true');
    // Back at the top, the first chip (Overview) wins (covers the page-intro above section 1).
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(page.locator('.chip[data-target="sec-need"]')).toHaveAttribute('aria-current', 'true');
});

// Whole-app review, Nov 2026: the Railcard and Rangers bars had drifted from the FIP one above. With
// Reduce Motion on they still animated a scroll of several thousand pixels, and after a jump the chip
// they marked current stayed current wherever the reader went — "Digital" lit over the quick check.
// The scroll's behaviour is read off the call itself, because an instant and a smooth jump end in the
// same place and a test that only looked at the landing could not tell them apart.
for (const [guide, first, last] of /** @type {Array<[string, string, string]>} */ ([
    ['railcard-guide', 'rc-quick', 'rc-digital'],
    ['rangers-guide', 'rr-quick', 'rr-checks'],
])) {
    test(`${guide}: a chip jump honours Reduce Motion, and the current chip follows the reader`, async ({ page }) => {
        await page.addInitScript(() => {
            /** @type {string[]} */
            const calls = [];
            /** @type {any} */ (window).__scrollCalls = calls;
            const real = Element.prototype.scrollIntoView;
            Element.prototype.scrollIntoView = function (/** @type {any} */ arg) {
                calls.push(arg && typeof arg === 'object' ? (arg.behavior ?? 'auto') : 'auto');
                return real.call(this, arg);
            };
        });
        const lastChip = page.locator(`.chip-bar .chip[data-target="${last}"]`);
        const firstChip = page.locator(`.chip-bar .chip[data-target="${first}"]`);
        const lastCall = () => page.evaluate(() => /** @type {any} */ (window).__scrollCalls.at(-1));

        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.goto(`/${guide}.html`);
        await lastChip.click();
        expect(await lastCall(), 'the jump under Reduce Motion').toBe('auto');
        await expect(lastChip).toHaveAttribute('aria-current', 'true');
        await page.evaluate(() => window.scrollTo(0, 0));
        await expect(firstChip, 'back at the top, the first chip is current again').toHaveAttribute('aria-current', 'true');
        await expect(lastChip).not.toHaveAttribute('aria-current', 'true');

        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await page.reload();
        await lastChip.click();
        expect(await lastCall(), 'the jump with motion allowed').toBe('smooth');
    });
}

// Whole-app review, Nov 2026: heading navigation on the Railcard guide stopped at the A–Z section —
// reaching "Network" meant reading through eight cards — because a card's name was a plain span; two
// Rangers headings announced their status pill as part of the title; and every FIP country was read
// out with its flag and a "down-pointing triangle". Read from the accessibility tree, which is what a
// screen reader is given, not from the markup.
for (const [guide, cardSel, nameSel] of /** @type {Array<[string, string, string]>} */ ([
    ['railcard-guide', '.rc[id]', '.rc-name'],
    ['rangers-guide', '.rr-card[id], .rr-no-item[id]', '.rr-name, .rr-no-name'],
])) {
    test(`${guide}: every card is a level-3 heading by its own name, and no heading reads a status pill`, async ({ page }) => {
        await page.goto(`/${guide}.html`);
        const cards = page.locator(cardSel);
        const count = await cards.count();
        expect(count, 'the cards are where this test looks for them').toBeGreaterThan(5);
        for (let i = 0; i < count; i++) {
            const card = cards.nth(i);
            const name = (await card.locator(nameSel).first().innerText()).replace(/\s+/g, ' ').trim();
            const headings = card.getByRole('heading', { level: 3 });
            await expect(headings, `${await card.getAttribute('id')} has one heading`).toHaveCount(1);
            await expect(headings).toHaveAccessibleName(name);
        }
        await expect(page.getByRole('heading', { name: /checked ·|Source conflict|source not yet verified/i }),
            'a heading whose name carries a status pill').toHaveCount(0);
    });
}

test('fip: a country is announced by its name, not its disclosure triangle', async ({ page }) => {
    await page.goto('/fip-guide.html');
    const snapshot = await page.locator('#sec-countries ~ details[id^="country-"]').first().ariaSnapshot();
    expect(snapshot, 'the snapshot reads the card at all').toContain('France');
    expect(snapshot).not.toContain('▾');
    await expect(page.locator('summary .chevron')).not.toHaveCount(0);
    await expect(page.locator('summary .chevron:not([aria-hidden="true"])'), 'a chevron a screen reader reads out').toHaveCount(0);
});

// Whole-app review, Nov 2026: the primary button "📞 Trainseurope — 01354 660222" opened Trainseurope's
// website in a new tab. A member who taps a telephone and a number expects a call. So any link that
// SHOWS a phone number must dial THAT number, and the website is a link of its own.
test('fip: a link that shows a phone number dials it, and the website is its own link', async ({ page }) => {
    await page.goto('/fip-guide.html');
    const shown = await page.locator('a').evaluateAll(links => links
        .map(a => ({ text: (a.textContent || '').replace(/\s+/g, ' ').trim(), href: a.getAttribute('href') || '' }))
        .filter(l => /📞|\b0\d{4} ?\d{6}\b/.test(l.text)));
    expect(shown.length, 'the Trainseurope button is where this test looks').toBeGreaterThan(0);
    for (const link of shown) {
        const number = (link.text.match(/\b0\d{4} ?\d{6}\b/) || [''])[0].replace(/\s/g, '');
        expect(link.href, `"${link.text}" must dial ${number}`).toBe(`tel:+44${number.slice(1)}`);
    }
    const site = page.locator('#sec-apply ~ a[href^="https://www.trainseurope.co.uk"]');
    await expect(site).toHaveCount(1);
    await expect(site).toContainText('website');
});

// Owner decision, 10 Nov 2026: every phone number a guide SHOWS can be tapped to call. The FIP guide had
// one call button and six numbers you could only copy — Trainseurope three times, the SNCF line and two
// Stena numbers — and on a phone, at a ticket office abroad, the tap is the point. Read off the rendered
// text, so a number added later in any guide is held to the same rule without anybody listing it here.
test('guides: every phone number a guide shows is a link that dials it', async ({ page }) => {
    for (const { url } of GUIDE_PAGES) {
        await page.goto(url);
        const found = await page.evaluate(() => {
            const re = /(\+\d{1,3}(?:[\s\u00a0]\d{1,4}){2,6}|\b0\d{2,4}(?:[\s\u00a0]\d{3,8}){1,2}\b)/g;
            /** @type {Array<{shown: string, href: string}>} */ const out = [];
            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
            for (let n = walker.nextNode(); n; n = walker.nextNode()) {
                for (const m of (n.nodeValue || '').matchAll(re)) {
                    out.push({ shown: m[0], href: n.parentElement?.closest('a')?.getAttribute('href') || '' });
                }
            }
            return out;
        });
        for (const { shown, href } of found) {
            const digits = shown.replace(/[\s\u00a0]/g, '');
            const dial = 'tel:' + (digits.startsWith('+') ? digits : `+44${digits.slice(1)}`);
            expect(href, `${url}: "${shown}" is shown as a number you cannot tap, or that dials another`).toBe(dial);
        }
        if (url === '/fip-guide.html') expect(found.length, 'the sweep no longer finds the FIP guide\'s seven numbers').toBe(7);
    }
});

// Whole-app review, Nov 2026 (a lead from the PWA reader): every app page names its tab icon, and the
// guides named none, so a browser fell back to the ORIGIN's /favicon.ico — which neither origin has,
// and which on the Pages mirror is a different site altogether. Each guide now asks for the app's
// own icon. (paycalc-guide.html belongs to another area and is reported there.)
//
// The icon is LOADED here, not waited for. Whether a browser fetches a tab icon at all is its own affair: CI's
// headless Chromium and WebKit never do, so a wait for the request timed out on the three guides with no <img>
// of the same file — the Staff and Pay Calculator guides passed only because their header logo is one
// (10 Nov 2026). What a browser falls back from is a page that names no icon, or names one that is not there.
for (const guide of ['staff-guide', 'paycalc-guide', 'railcard-guide', 'fip-guide', 'rangers-guide']) {
    test(`${guide}: names the app's own tab icon, so the browser never falls back to /favicon.ico`, async ({ page }) => {
        await page.goto(`/${guide}.html`);
        const icon = page.locator('link[rel="icon"][href$="icon-192.png"]');
        await expect(icon).toHaveCount(1);
        const width = await icon.evaluate((link) => new Promise((done) => {
            const img = new Image();
            img.onload = () => done(img.naturalWidth);
            img.onerror = () => done(0);
            img.src = /** @type {HTMLLinkElement} */ (link).href;
        }));
        expect(width, 'the icon the page names is there, and is the 192px app icon').toBe(192);
    });
}

test('fip: a "popular" shortcut opens its country, clearing an active filter first', async ({ page }) => {
    await page.goto('/fip-guide.html');
    // Filter so France is hidden, then tap the popular France shortcut: it must clear the filter,
    // reveal France, and open it.
    await page.locator('#countrySearch').fill('spain');
    await expect(page.locator('#country-fr')).toBeHidden();
    await page.locator('.cf-popular a[href="#country-fr"]').click();
    await expect(page.locator('#country-fr')).toBeVisible();
    await expect(page.locator('#country-fr')).toHaveAttribute('open', '');
    await expect(page.locator('#countrySearch')).toHaveValue('');
});

// ── FIP: the booking-reach table (v20.31–32) ───────────────────────────────────────────────────
//
// This is the only table on the guide, and it exists because "can I book this before I leave?" was
// the question the page could not answer. Two things about it can break WITHOUT anything throwing,
// which is why they are tested rather than eyeballed:
//
//   1. The country finder selects cards by `[id^="country-"]`. The table is a <details> sitting in
//      a different section, so it must be invisible to the filter — if a future id or selector
//      change swept it in, typing a country name would hide the table that answers the question
//      about that country. Nothing would error; the table would just vanish.
//
//   2. Below 560px the rows STACK, and each cell states its own column through a `data-label`
//      ::before. Before that, the international column clipped at the card edge with no scroll
//      affordance — so "Trains to Romania only" read as "Trai…", and a truncated answer looks like
//      a whole one. The stacked layout is a CSS media query over generated content: a static test
//      cannot see it and a unit test has no layout, so it takes a real browser at a real width.
test('fip: the booking-reach table answers per country, and the finder leaves it alone', async ({ page }) => {
    await page.goto('/fip-guide.html');
    const table = page.locator('#booking-table');
    await table.evaluate(el => { el.open = true; });

    // Every country RST lists gets a row, and the three answer classes all render.
    await expect(table.locator('tbody tr')).toHaveCount(22);
    // Match on the ROW HEADER, not row text: several rows name another country in their
    // international column ("TER/IC to Belgium"), so `hasText` picks up three rows for Belgium.
    const rowFor = name => table.locator('tbody tr').filter({
        has: page.locator(`td[role="rowheader"]:text-is("${name}")`),
    });
    await expect(rowFor('Belgium').locator('td[data-label="Domestic"]'))
        .toContainText('75% is ticket offices only');
    await expect(rowFor('France').locator('td[data-label="Domestic"]'))
        .toContainText('SNCF Contact Centre');
    await expect(rowFor('Spain').locator('td[data-label="Domestic"]')).toHaveClass(/t-yes/);

    // A "no" must never be presented as a refusal of FIP — the caption carries that, and it is the
    // difference between "you cannot go" and "buy it when you arrive".
    await expect(table).toContainText('buy it at a ticket office when you get there');

    // The finder must not touch it: filter to one country and the table stays put.
    await page.locator('#countrySearch').fill('spain');
    await expect(page.locator('#country-fr')).toBeHidden();
    await expect(table).toBeVisible();
});

test('fip: the booking table stacks with labelled cells on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 900 });
    await page.goto('/fip-guide.html');
    await page.locator('#booking-table').evaluate(el => { el.open = true; });

    // The stacked layout announces each column per cell. Read the generated content, because that
    // IS the header on this layout — the real <thead> is clipped away.
    const label = await page.locator('#booking-table tbody td[data-label]').first()
        .evaluate(el => getComputedStyle(el, '::before').content);
    expect(label).toContain('Domestic');

    // Rows must be blocks, not table-rows — that is what proves the media query applied.
    const display = await page.locator('#booking-table tbody tr').first()
        .evaluate(el => getComputedStyle(el).display);
    expect(display).toBe('block');

    // And nothing may clip: the answer text must fit inside its own cell at this width.
    const overflow = await page.locator('#booking-table tbody td[data-label]')
        .evaluateAll(tds => tds.filter(td => td.scrollWidth > td.clientWidth + 1).length);
    expect(overflow).toBe(0);

    // The page itself must not scroll sideways either.
    const bodyOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(bodyOverflow).toBeLessThanOrEqual(0);
});

// ── GUIDE POLISH (round 2) ─────────────────────────────────────────────────────────────────────
// Four owner-approved layout fixes, each pinned by its measured outcome rather than by the rule
// that produced it — every one of them rendered "fine" before, and was wrong only by position.

// The three chip-bar guides centre a 760px column but the chip bar is full-bleed, so the chips used
// to start at the window edge (x=12 at 1280) while the text started at x=276.
test('guides: from 800px the section chips start where the content column\'s text does', async ({ page }) => {
    const pages = { 'fip-guide': '.content', 'railcard-guide': '.content', 'rangers-guide': 'main' };
    for (const [guide, column] of Object.entries(pages)) {
        for (const width of [1280, 800]) {
            await page.setViewportSize({ width, height: 900 });
            await page.goto(`/${guide}.html`);
            const m = await page.evaluate((sel) => {
                const c = /** @type {HTMLElement} */ (document.querySelector(sel));
                const firstChip = /** @type {HTMLElement} */ (document.querySelector('.chip-bar .chip'));
                return {
                    text: c.getBoundingClientRect().left + parseFloat(getComputedStyle(c).paddingLeft),
                    chip: firstChip.getBoundingClientRect().left,
                };
            }, column);
            expect(Math.abs(m.chip - m.text), `${guide} at ${width}px: first chip at ${m.chip}, text at ${m.text}`)
                .toBeLessThanOrEqual(1);
        }
    }
    // Below the breakpoint nothing moved: the bar keeps its 12px phone gutter.
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto('/fip-guide.html');
    expect(await page.locator('.chip-bar .chip').first().evaluate(el => Math.round(el.getBoundingClientRect().left)))
        .toBe(12);
});

// …and the header above them (desktop audit, Nov 2026). Its ← and ⤓ PDF sat at the window's edges —
// the ← at x=16 over text starting at x=596 at 1920 — on all five guides, so the two controls read as
// the browser's rather than the page's. From 800px the navy band stays full-bleed and its contents
// take the column's edges, as the chips do; a phone keeps its 16px gutter. The amber source banner
// between them (railcard, rangers) sat 16px left of both, and takes the same edges.
test('guides: from 800px the header\'s ← and ⤓ PDF sit on the content column\'s edges', async ({ page }) => {
    const pages = { 'fip-guide': '.content', 'railcard-guide': '.content', 'rangers-guide': 'main',
                    'staff-guide': '.page', 'paycalc-guide': '.page' };
    for (const [guide, column] of Object.entries(pages)) {
        for (const width of [1920, 1366, 800]) {
            await page.setViewportSize({ width, height: 900 });
            await page.goto(`/${guide}.html`);
            const m = await page.evaluate((sel) => {
                const c = /** @type {HTMLElement} */ (document.querySelector(sel));
                const cs = getComputedStyle(c), r = c.getBoundingClientRect();
                const back = /** @type {HTMLElement} */ (document.querySelector('.page-header .btn-back')).getBoundingClientRect();
                const pdf = /** @type {HTMLElement} */ (document.querySelector('.page-header .btn-pdf')).getBoundingClientRect();
                const band = /** @type {HTMLElement} */ (document.querySelector('.page-header')).getBoundingClientRect();
                // The amber source banner between the header and the chips (railcard, rangers) too.
                const banner = document.querySelector('.source-banner > *')?.getBoundingClientRect();
                return { textLeft: r.left + parseFloat(cs.paddingLeft), textRight: r.right - parseFloat(cs.paddingRight),
                         back: back.left, pdf: pdf.right, bandLeft: band.left, bandRight: band.right,
                         banner: banner ? [banner.left, banner.right] : null };
            }, column);
            expect(Math.abs(m.back - m.textLeft), `${guide} at ${width}px: ← at ${m.back}, the text at ${m.textLeft}`).toBeLessThanOrEqual(1);
            expect(Math.abs(m.pdf - m.textRight), `${guide} at ${width}px: ⤓ PDF ends at ${m.pdf}, the text at ${m.textRight}`).toBeLessThanOrEqual(1);
            expect([m.bandLeft, m.bandRight], `${guide} at ${width}px: the navy band stays full-bleed`).toEqual([0, width]);
            if (m.banner) {
                expect(Math.abs(m.banner[0] - m.textLeft) + Math.abs(m.banner[1] - m.textRight),
                    `${guide} at ${width}px: the source banner's words span ${m.banner}, the text ${m.textLeft}–${m.textRight}`).toBeLessThanOrEqual(2);
            }
        }
    }
    // Below the breakpoint nothing moved: the header keeps its 16px phone gutter.
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto('/fip-guide.html');
    expect(await page.locator('.page-header .btn-back').evaluate(el => Math.round(el.getBoundingClientRect().left))).toBe(16);
});

// The 760px column held the card guides' 12–14px prose at 110–140 characters a line on a desktop
// (desktop audit, Nov 2026). From 1024px a paragraph keeps the app's reading measure (css-tokens.md →
// "Reading measure"; 64ch — the low end of its 64–72ch, because 68ch measured 102 characters on CI's
// render of one Railcard paragraph); a phone is untouched. Counted in
// CHARACTERS, by measuring each paragraph's own text in its own font, because "too long" is a count
// of letters, not of pixels.
test('guides: a paragraph keeps a reading measure on a desktop, and a phone is untouched', async ({ page }) => {
    /** The most characters any full line of a `main` paragraph holds. */
    const longest = () => page.evaluate(() => {
        const ctx = /** @type {CanvasRenderingContext2D} */ (document.createElement('canvas').getContext('2d'));
        let most = 0;
        for (const p of document.querySelectorAll('main p')) {
            const r = p.getBoundingClientRect();
            if (!r.width) continue;
            const cs = getComputedStyle(p);
            ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
            const text = (p.textContent || '').replace(/\s+/g, ' ').trim();
            const width = ctx.measureText(text).width;
            const room = r.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
            if (width > room * 1.2) most = Math.max(most, Math.round(text.length * room / width));   // wraps, with a full line
        }
        return most;
    });
    for (const guide of ['railcard-guide', 'rangers-guide', 'fip-guide']) {
        await page.setViewportSize({ width: 1366, height: 900 });
        await page.goto(`/${guide}.html`);
        await page.evaluate(() => document.fonts.ready);
        await page.evaluate(() => document.querySelectorAll('details').forEach(d => { d.open = true; }));
        expect(await longest(), `${guide} at 1366px: the longest paragraph line, in characters`).toBeLessThanOrEqual(100);
        await page.setViewportSize({ width: 390, height: 900 });
        await page.goto(`/${guide}.html`);
        expect(await page.locator('main p').first().evaluate(p => getComputedStyle(p).maxWidth), `${guide}: no measure on a phone`).toBe('none');
    }
});

// The Railcard quick check on a desktop (owner, Nov 2026: LARGER TEXT, not a narrower card). Its
// note keeps the 64ch measure above, and at 12.5px that stopped about 200px short of a ~700px card —
// each card measured ~30% empty on its right here, ~20% on CI's slightly wider render. One factor
// (`--qc-scale`, railcard-guide.css) now steps every size in the card up together. Pinned by what it
// is FOR: each card's widest line reaches near its content edge, every size grows by the SAME factor
// (the hierarchy is kept, not merely the sizes raised), and a phone and paper keep the old sizes.
test('railcard: on a desktop the quick-check type steps up to fill its cards, and a phone and paper do not', async ({ page }) => {
    const measure = () => page.evaluate(() => [...document.querySelectorAll('.qc-group')].map(g => {
        const cs = getComputedStyle(g), r = g.getBoundingClientRect();
        const left = r.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft);
        const right = r.right - parseFloat(cs.borderRightWidth) - parseFloat(cs.paddingRight);
        let textRight = left;
        for (const el of g.querySelectorAll('.qc-head, .qc-cards, .qc-note')) {
            const range = document.createRange();
            range.selectNodeContents(el);
            for (const line of range.getClientRects()) textRight = Math.max(textRight, line.right);
        }
        const size = (/** @type {string} */ sel) => parseFloat(getComputedStyle(/** @type {Element} */ (g.querySelector(sel))).fontSize);
        return { name: g.className, head: size('.qc-head'), cards: size('.qc-cards'), note: size('.qc-note'),
                 empty: (right - textRight) / (right - left) };
    }));
    const open = async (/** @type {number} */ width) => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto('/railcard-guide.html');
        await page.evaluate(() => document.fonts.ready);
    };
    await open(390);
    const phone = await measure();
    expect(phone.length, 'the five quick-check groups').toBe(5);
    for (const width of [1366, 1920]) {
        await open(width);
        const desk = await measure();
        desk.forEach((card, i) => {
            const step = card.note / phone[i].note;
            expect(step, `${card.name} at ${width}px: the note grows on a desktop`).toBeGreaterThan(1.15);
            expect(Math.abs(card.head / phone[i].head - step), `${card.name} at ${width}px: the head grows by the note's factor`).toBeLessThan(0.01);
            expect(Math.abs(card.cards / phone[i].cards - step), `${card.name} at ${width}px: the card list grows by the note's factor`).toBeLessThan(0.01);
            expect(card.empty, `${card.name} at ${width}px: the widest line stops ${Math.round(card.empty * 100)}% short of the card's edge`).toBeLessThan(0.15);
        });
    }
    // Paper keeps the phone's sizes at any width: the step is `screen` only.
    await page.emulateMedia({ media: 'print' });
    const paper = await measure();
    expect(paper.map(c => c.note), 'printed, the notes keep their size').toEqual(phone.map(c => c.note));
    await page.emulateMedia({ media: 'screen' });
});

// The Staff guide drew every Calendar button it describes in navy, while the real ones are gold 📍,
// navy 👥 Team, teal 🏖️ AL, navy-with-gold 📝 Admin and green 💷 Pay (desktop audit, Nov 2026) — five
// buttons a reader could not match to the screen by sight. Compared with the REAL buttons, read off
// the Calendar, within a whisker: the guides keep their own print-friendly palette, which mirrors the
// app's by eye (guide-colour-parity.test.mjs), so a near-match is the contract, not an exact one.
test('staff guide: each button it describes wears the real button\'s colours', async ({ page }) => {
    await seedMemberSession(page, 'G. Miller');
    await page.goto('/');
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    const ids = { today: '#todayBtn', team: '#teamViewBtn', al: '#alBtn', admin: '#adminBtn', pay: '#payBtn' };
    /** @param {string} css */
    const rgb = (css) => page.evaluate((c) => {
        const ctx = /** @type {CanvasRenderingContext2D} */ (document.createElement('canvas').getContext('2d', { willReadFrequently: true }));
        ctx.fillStyle = c; ctx.fillRect(0, 0, 1, 1);
        return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3);
    }, css);
    /** @type {Record<string, { fill: number[], ink: number[] }>} */
    const real = {};
    for (const [k, sel] of Object.entries(ids)) {
        // Once its transitions finish: iPhone WebKit read the Today button mid-fade (243,200,34).
        const cs = await page.locator(sel).evaluate(el => Promise.all(el.getAnimations().map(a => a.finished.catch(() => {})))
            .then(() => ({ fill: getComputedStyle(el).backgroundColor, ink: getComputedStyle(el).color })));
        real[k] = { fill: await rgb(cs.fill), ink: await rgb(cs.ink) };
    }
    await page.goto('/staff-guide.html');
    for (const k of Object.keys(ids)) {
        const cs = await page.locator(`.feature-label--${k}`).evaluate(el => ({ fill: getComputedStyle(el).backgroundColor, ink: getComputedStyle(el).color }));
        const label = { fill: await rgb(cs.fill), ink: await rgb(cs.ink) };
        for (const part of /** @type {const} */ (['fill', 'ink'])) {
            const off = Math.max(...label[part].map((v, i) => Math.abs(v - real[k][part][i])));
            expect(off, `${k}: the guide's ${part} ${label[part]} — the real button's ${real[k][part]}`).toBeLessThanOrEqual(24);
        }
    }
});

// NIGHT IS THE OUTLINED BADGE, IN THE KEY AS IN THE APP (whole-app review, Nov 2026). The app draws 🦉 Night white, with
// its colour as the words and a 2px edge; the Staff Guide's key drew it filled, so a reader learnt a Night badge the
// Calendar never shows. Read off the app's own badge — built from its classes on an app page — and off the key's.
test('staff guide: the badge key draws Night as the app does — white, with an outline in its colour', async ({ page }) => {
    const look = (/** @type {string} */ sel) => page.locator(sel).first().evaluate(el => {
        const c = getComputedStyle(el);
        return { fill: c.backgroundColor, edge: `${c.borderTopStyle} ${c.borderTopWidth}`, wordsWearTheEdge: c.color === c.borderTopColor };
    });
    await page.goto('/settings.html');
    await page.evaluate(() => {
        const badge = document.createElement('span');
        badge.className = 'shift-badge badge-night';
        badge.id = 'appNight';
        badge.textContent = '🦉 Night';
        document.body.append(badge);
    });
    const app = await look('#appNight');
    expect(app, 'premise: the app\'s Night badge is white, edged in its own colour').toEqual({ fill: 'rgb(255, 255, 255)', edge: 'solid 2px', wordsWearTheEdge: true });
    await page.goto('/staff-guide.html');
    expect(await look('.badge-grid .sb-night'), 'the key\'s Night badge').toEqual(app);
    // …and it stays the size of the filled badges beside it: its padding gives back the edge.
    const heights = await page.locator('.badge-grid .sb').evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().height)));
    expect(new Set(heights).size, `the key's badges are one height: ${heights}`).toBe(1);
});

// THE BANNER'S TITLE HAS THE MARGIN ITS OWN RULE GIVES IT (whole-app review, Nov 2026). It is an h2 and the first of its
// own wrapper, so the section headings' `h2:first-of-type { margin-top: 4px }` — the same weight, written later — beat
// the banner's `margin: 0` on screen, and the Admin Guide banner stood 4px taller than written (paper zeroed both).
test('staff guide: the on-screen banner\'s title has no top margin, as on paper', async ({ page }) => {
    for (const width of [375, 900]) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto('/staff-guide.html');
        const title = page.locator('.guide-header:visible h2');
        await expect(title, 'premise: one banner is on screen — the Admin Guide\'s').toHaveCount(1);
        expect(await title.evaluate(h => getComputedStyle(h).marginTop), `the banner title's top margin at ${width}px`).toBe('0px');
    }
});

// A GRID TRACK IS ONLY AS NARROW AS ITS WIDEST CHILD ALLOWS (css-tokens.md), on the document guides (whole-app review,
// Nov 2026). `.cols` had bare `1fr` tracks, so with the text enlarged one child that will not shrink — the Staff Guide's
// two-column badge key — widened the column past a phone's edge, and every paragraph, heading and table in it ran off
// the right. The text is scaled as Android's font scale scales it (`scaleText`): every size multiplied, the viewport
// left alone.
test('staff guide: enlarged text does not widen the column past a phone @layout', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto('/staff-guide.html');
    await page.evaluate(() => document.fonts.ready);
    await scaleText(page, 1.5);
    const m = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        const cols = /** @type {HTMLElement[]} */ ([...document.querySelectorAll('.cols')]);
        return {
            tracks: cols.map(c => ({ track: parseFloat(getComputedStyle(c).gridTemplateColumns), box: c.getBoundingClientRect().width })),
            past: [...document.querySelectorAll('.cols p, .cols h2, .cols table, .cols .info')]
                .filter(el => el.getBoundingClientRect().right > vw + 1).length,
        };
    });
    for (const { track, box } of m.tracks) {
        expect(track, `a column's track is ${track}px in its ${box}px box`).toBeLessThanOrEqual(box + 0.5);
    }
    expect(m.past, 'paragraphs, headings, tables and notes running past the screen\'s edge').toBe(0);
});

// The ← had no hover on four guides, and on the Railcard guide that page's `a:hover` (amber, meant for
// links in the text) reached it — amber on navy, ~3.3:1 (desktop audit, Nov 2026). One hover now, the
// shell's, read off the rendered arrow under a real mouse.
test('guides: the ← answers a mouse with one hover on every guide, never a page\'s link colour', async ({ page }, info) => {
    test.skip(isTouchProject(info), 'a hover is a fine pointer\'s');
    for (const guide of ['staff-guide', 'paycalc-guide', 'railcard-guide', 'rangers-guide', 'fip-guide']) {
        await page.goto(`/${guide}.html`);
        const gold = await page.evaluate(() => {
            const probe = document.createElement('span');
            probe.style.color = 'var(--gold)';
            document.body.append(probe);
            const c = getComputedStyle(probe).color;
            probe.remove();
            return c;
        });
        const back = page.locator('.page-header .btn-back');
        await back.hover();
        await expect.poll(() => back.evaluate(el => getComputedStyle(el).color), { message: `${guide}: the ← on hover` }).toBe(gold);
    }
});

// "Search a country or operator — e.g. Spain, ÖBB, Railjet" was 418px of text in a 282px field at
// 390, so it read "— e.g. S…". The ellipsis stays as a safety net; this pins that it is not needed.
test('fip: the country search placeholder fits a 390px phone whole', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto('/fip-guide.html');
    await page.evaluate(() => document.fonts.ready);
    const fit = await page.locator('#countrySearch').evaluate(el => {
        const input = /** @type {HTMLInputElement} */ (el);
        const cs = getComputedStyle(input);
        const ctx = /** @type {CanvasRenderingContext2D} */ (document.createElement('canvas').getContext('2d'));
        ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
        return {
            text: ctx.measureText(input.placeholder).width,
            room: input.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight),
        };
    });
    expect(fit.text, `placeholder is ${fit.text}px in a ${fit.room}px field`).toBeLessThanOrEqual(fit.room);
});

// Side by side at 390 each "What you get" card was 174px wide — ~22 characters of 12px text a line.
test('fip: the "What you get" cards stack on a phone and pair on a wider screen', async ({ page }) => {
    const boxes = () => page.locator('.two-up .card').evaluateAll(cards =>
        cards.map(c => { const r = c.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), bottom: Math.round(r.bottom) }; }));
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto('/fip-guide.html');
    const phone = await boxes();
    expect(phone).toHaveLength(2);
    expect(phone[1].x, 'one column: same left edge').toBe(phone[0].x);
    expect(phone[1].y, 'one column: the second card is below the first').toBeGreaterThanOrEqual(phone[0].bottom);

    await page.setViewportSize({ width: 800, height: 900 });
    await page.goto('/fip-guide.html');
    const wide = await boxes();
    expect(wide[1].y, 'a pair: same top edge').toBe(wide[0].y);
    expect(wide[1].x).toBeGreaterThan(wide[0].x);
});

// The three guides that close with a back link each drew a different one: railcard centred, plain
// and 38px tall; rangers left and bold; FIP a full-width text button reading "Back to roster" above
// its disclaimer. One shared recipe now (guide-shell.css), one wording, the last thing on the page.
test('guides: the footer back link is one control with one wording on every guide', async ({ page }) => {
    const seen = [];
    for (const guide of ['railcard-guide', 'rangers-guide', 'fip-guide']) {
        await page.goto(`/${guide}.html`);
        const links = page.locator('main a').filter({ hasText: /Back to (calendar|roster)/ });
        await expect(links, `${guide}: exactly one footer back link`).toHaveCount(1);
        const link = links.first();
        await expect(link).toHaveClass('guide-back-link');
        await expect(link).toHaveText('← Back to calendar');
        await expect(link).toHaveAttribute('href', './');
        await link.scrollIntoViewIfNeeded();
        const m = await link.evaluate(a => {
            const r = a.getBoundingClientRect();
            const main = /** @type {HTMLElement} */ (a.closest('main'));
            const mr = main.getBoundingClientRect();
            const cs = getComputedStyle(main);
            const left = mr.left + parseFloat(cs.paddingLeft), right = mr.right - parseFloat(cs.paddingRight);
            const s = getComputedStyle(a);
            return {
                height: r.height,
                centreOffset: Math.abs((r.left + r.right) / 2 - (left + right) / 2),
                last: a === main.lastElementChild,
                style: [s.display, s.fontSize, s.fontWeight, s.textDecorationLine].join(' '),
            };
        });
        expect(m.height, `${guide}: 44px touch target`).toBeGreaterThanOrEqual(44);
        expect(m.centreOffset, `${guide}: centred under the column`).toBeLessThanOrEqual(1);
        expect(m.last, `${guide}: the last thing on the page`).toBe(true);
        seen.push(m.style);
    }
    expect(new Set(seen).size, `one recipe, got: ${seen.join(' | ')}`).toBe(1);
});

// ONE UNDER A MOUSE TOO (whole-app review, Nov 2026). The recipe above was one at rest and three when
// hovered, because each page's own `a:hover` reached the link: amber words on Railcard, a gold underline
// on FIP, nothing at all on Rangers. Read off the rendered link, at rest and under a real mouse.
test('guides: the footer back link answers a mouse the same way on every guide', async ({ page }, info) => {
    test.skip(isTouchProject(info), 'a hover is a fine pointer\'s');
    const seen = [];
    for (const guide of ['railcard-guide', 'rangers-guide', 'fip-guide']) {
        await page.goto(`/${guide}.html`);
        const link = page.locator('main a.guide-back-link');
        await link.scrollIntoViewIfNeeded();
        const look = () => link.evaluate(a => {
            const s = getComputedStyle(a);
            return `words ${s.color}, underline ${s.textDecorationColor}`;
        });
        await page.mouse.move(0, 0);
        const rest = await look();
        await link.hover();
        const hovered = await look();
        expect(hovered, `${guide}: the link answers a mouse`).not.toBe(rest);
        seen.push(`${rest} → ${hovered}`);
    }
    expect(new Set(seen).size, `one hover, got: ${seen.join(' | ')}`).toBe(1);
});

// ADDED TO THE HOME SCREEN, A GUIDE IS THE APP (iPhone audit, 7 Nov 2026). Each guide asked iOS to run
// it as an app with its own title and no manifest, so "Add to Home Screen" from a guide made a guide
// app: its own icon, its own storage, signed out. page-contract-parity reads the markup; this follows
// the link the browser follows, to the manifest it would install, and checks where that app starts.
test('guides: added to the Home Screen, every guide installs the app, under the app\'s name', async ({ page }) => {
    for (const guide of ['staff-guide', 'paycalc-guide', 'railcard-guide', 'rangers-guide', 'fip-guide']) {
        await page.goto(`/${guide}.html`);
        const seen = await page.evaluate(async () => {
            const link = /** @type {HTMLLinkElement|null} */ (document.querySelector('link[rel="manifest"]'));
            if (!link) return null;
            const m = await (await fetch(link.href)).json();
            return {
                start: new URL(m.start_url, link.href).pathname,
                scope: new URL(m.scope, link.href).pathname,
                label: document.querySelector('meta[name="apple-mobile-web-app-title"]')?.getAttribute('content'),
            };
        });
        expect(seen, `${guide}: no manifest link — an iPhone would install the guide as an app of its own`).not.toBeNull();
        expect(seen?.start, `${guide}: the install would open somewhere other than the Calendar`).toBe('/');
        expect(seen?.scope, `${guide}: the install would not cover the whole app`).toBe('/');
        expect(seen?.label, `${guide}: the home-screen icon would carry the guide's own name`).toBe('MYB Roster');
    }
});

// ...AND THE STAFF GUIDE'S iPHONE STEPS SAY WHERE TO STAND (iPhone audit, 7 Nov 2026). Followed on the
// guide itself, "Share → Add to Home Screen" added the guide; and on iOS 26 Safari keeps Share under •••.
test('staff guide: the iPhone install card says to add it from the Calendar, and where Share is on iOS 26', async ({ page }) => {
    await page.goto('/staff-guide.html');
    const card = page.locator('.install-card').filter({ hasText: 'iPhone' });
    await expect(card).toHaveCount(1);
    await expect(card).toContainText('On the roster’s Calendar page, not this guide');
    await expect(card).toContainText('Share (□↑), or ••• then Share');
    await expect(card).toContainText('→ Add to Home Screen');
});

// Every country and ferry card states when it was checked. guide-sources.test.mjs proves the line is
// PRESENT in the markup and that its date matches the register; this proves it is actually VISIBLE
// once the card is open — a static check cannot tell an evidence line from one a stylesheet hides.
//
// THE DATE IS READ FROM THE REGISTER, not written here (test audit, 7 Nov 2026 — UI-18). This
// expected 'Checked Aug 2026' as a literal, and the Czech row is due for review again in December
// 2026: the re-review it asks for — register row and card updated together, exactly as the static
// test requires — would have broken this test for doing the right thing. The card's first cited row
// is the one whose `Reviewed` it shows (guide-sources.test.mjs), so that is the date expected here.
test('fip: an opened country card shows its checked date', async ({ page }) => {
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const register = readFileSync(new URL('../docs/GUIDE_SOURCES.md', import.meta.url), 'utf8');
    const row = register.split('\n').find(l => l.startsWith('| fip-cz |'));
    expect(row, 'the fip-cz register row').toBeTruthy();
    // Columns: ID | Guide | Claim | Class | Reviewed | Next | Source — Reviewed is fifth.
    const reviewed = String(row).split('|').slice(1, -1).map(c => c.trim())[4];
    expect(reviewed, 'a YYYY-MM Reviewed date').toMatch(/^\d{4}-\d{2}$/);
    const [year, month] = reviewed.split('-').map(Number);

    await page.goto('/fip-guide.html');
    await page.locator('#country-cz').evaluate(el => { el.open = true; });
    const line = page.locator('#country-cz .country-reviewed');
    await expect(line).toBeVisible();
    await expect(line).toContainText(`Checked ${MONTHS[month - 1]} ${year}`);
});

// ── WHAT THE GUIDE STYLESHEETS OWE THE READER (whole-app fix, 10 Nov 2026) ───────────────────────────
// Each a fault in a guide's own stylesheet, invisible to the behaviour tests above, and measured on the
// rendered page. Larger text is modelled the way Android's setting works — every used font size
// multiplied, the viewport left alone (`scaleText`, helpers.js).

for (const [guide, row, label] of [['rangers-guide', '.rr-row', '.rr-lbl'], ['railcard-guide', '.rc-layer', '.rc-layer-lbl']]) {
    test(`${guide}: a row's label never runs into its value under larger text`, async ({ page }) => {
        // The label columns were fixed in pixels, sized for the default text: on a phone set larger,
        // DISCOUNTS ran 10px into its value at 1.3× and MARYLEBONE 3px into its sentence.
        for (const w of [360, 390]) for (const k of [1, 1.3]) {
            await page.setViewportSize({ width: w, height: 800 });
            await page.goto(`/${guide}.html`);
            await page.evaluate(() => document.fonts.ready);
            if (k !== 1) await scaleText(page, k);
            const worst = await page.evaluate(([row, label]) => {
                let found = { over: -Infinity, text: '' };
                for (const r of document.querySelectorAll(row)) {
                    const l = r.querySelector(label), v = l?.nextElementSibling;
                    if (!l || !v) continue;
                    const range = document.createRange();
                    range.selectNodeContents(l);
                    const over = range.getBoundingClientRect().right - v.getBoundingClientRect().left;
                    if (over > found.over) found = { over, text: (l.textContent || '').trim() };
                }
                return found;
            }, [row, label]);
            expect(worst.over, `${worst.text} into its value at ${w}px, ${k}× text`).toBeLessThanOrEqual(0);
        }
    });
}

test('guides: each side of the page takes its own safe-area inset', async ({ page, browserName }) => {
    // `padding` runs top, right, bottom, left. The Rangers guide had the two side insets crossed, and
    // both source banners used the left inset on both sides — so a phone held on its side with a
    // cut-out on one edge padded the other. Only Chromium can emulate an inset (a DevTools call).
    test.skip(browserName !== 'chromium', 'safe-area emulation is a Chromium DevTools call');
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 0, left: 0, bottom: 0, right: 44 } });
    for (const [guide, column] of [['rangers-guide', 'main'], ['railcard-guide', '.content'], ['fip-guide', '.content']]) {
        await page.goto(`/${guide}.html`);
        const [col, banner] = await page.evaluate((column) => [column, '.source-banner'].map(sel => {
            const el = document.querySelector(sel);
            if (!el) return null;
            const cs = getComputedStyle(el);
            return [cs.paddingLeft, cs.paddingRight];
        }), column);
        expect(col, `${guide}: the content column`).toEqual(['16px', '44px']);
        if (banner) expect(banner, `${guide}: the source banner`).toEqual(['16px', '44px']);
    }
});

// …and so does the chip bar, below 800px, where the shell gave both its sides the LEFT inset (from 800px its sides
// are the column's own edges, each with its own inset already).
test('guides: on a phone the chip bar takes each side\'s own safe-area inset', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'safe-area emulation is a Chromium DevTools call');
    await page.setViewportSize({ width: 390, height: 800 });
    const cdp = await page.context().newCDPSession(page);
    for (const [left, right] of [[0, 44], [44, 0]]) {
        await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 0, left, bottom: 0, right } });
        for (const guide of ['railcard-guide', 'rangers-guide', 'fip-guide']) {
            await page.goto(`/${guide}.html`);
            const pad = await page.locator('.chip-bar').evaluate(el => [getComputedStyle(el).paddingLeft, getComputedStyle(el).paddingRight]);
            expect(pad, `${guide}, a ${left || right}px inset on the ${left ? 'left' : 'right'}`)
                .toEqual([`${Math.max(12, left)}px`, `${Math.max(12, right)}px`]);
        }
    }
});

// ── WITH NO SCRIPT, THE CHIP BAR NEVER PARKS UNDER THE HEADER (whole-app fix, 10 Nov 2026) ────────────────────
// The bar's sticky `top` is the header's height, which only the page's script measures; the stylesheet's own
// figure is a guess. Stuck at it with no script, the bar sat under the header's last 24–41px at 360–390px (the
// header is 78px on FIP and 95px on Railcard and Rangers there, up to 138px at 320px). No one guess fits every
// header — taller than FIP's, it pushes that bar, which sits straight under the header, down over the page — and
// with no script the chips do nothing anyway (a script wires them), so the bar stays where the page puts it.
test.describe('guides with JavaScript off', () => {
    test.use({ javaScriptEnabled: false });

    test('the chip bar never parks under the header, and is not pushed over the page', async ({ page }) => {
        const geo = () => page.evaluate(() => {
            const bar = /** @type {HTMLElement} */ (document.querySelector('.chip-bar'));
            const hdr = /** @type {HTMLElement} */ (document.querySelector('.page-header')).getBoundingClientRect();
            const at = bar.getBoundingClientRect();
            bar.style.position = 'static';   // where the page itself puts the bar
            const flow = bar.getBoundingClientRect().top;
            bar.style.position = '';
            return { hdrBottom: hdr.bottom, top: at.top, bottom: at.bottom, flow };
        });
        for (const guide of ['railcard-guide', 'rangers-guide', 'fip-guide']) {
            for (const width of [320, 390, 1280]) {
                await page.setViewportSize({ width, height: 800 });
                await page.goto(`/${guide}.html`);
                await page.evaluate(() => document.fonts.ready);
                const rest = await geo();
                expect(Math.abs(rest.top - rest.flow), `${guide} at ${width}px: at the top of the page the bar is moved from its place (${rest.top} against ${rest.flow})`)
                    .toBeLessThanOrEqual(0.5);
                await page.evaluate(() => window.scrollTo(0, 1500));
                const s = await geo();
                expect(s.bottom <= s.hdrBottom + 0.5 || s.top >= s.hdrBottom - 0.5,
                    `${guide} at ${width}px, scrolled: the bar (${s.top}–${s.bottom}px) is part-hidden under the header (ends ${s.hdrBottom}px)`).toBe(true);
            }
        }
    });

    // The no-script half of the old addresses' redirect (below): the meta refresh still lands, at the top
    // of the guide, because a fixed URL is all it can carry. That is the floor the script raises.
    test('an old guide address still reaches its guide, at the top', async ({ page }) => {
        await page.goto('/fip.html?from=paycalc.html#country-de');
        await page.waitForURL(/\/fip-guide\.html$/);
        await page.goto('/guide.html#sg-getting-around');
        await page.waitForURL(/\/staff-guide\.html$/);
    });
});

// ── THE OLD ADDRESSES KEEP THE COUNTRY (owner, 10 Nov 2026) ────────────────────────────────────────
// guide.html and fip.html are stubs. Firebase's 301 keeps a bookmark's #fragment and ?query; the Pages
// mirror serves no redirects, so there the stub IS the redirect, and its meta refresh dropped both — an
// old fip.html#country-de opened the guide at the top with Germany shut. legacy-redirect.js carries them.
// The dev server serves no redirects either, so this is the mirror's path.
test('guides: an old address keeps its country, its query and the back arrow, and leaves no stub in history', async ({ page }) => {
    const errors = collectFatalErrors(page);
    const script = page.waitForResponse(r => r.url().endsWith('/legacy-redirect.js'));
    await page.goto('/fip.html?from=paycalc.html#country-de');
    expect((await script).status(), 'the stub fetched its script').toBe(200);
    await page.waitForURL(/\/fip-guide\.html\?from=paycalc\.html#country-de$/);
    await expect(page.locator('#country-de'), 'the bookmarked country is opened').toHaveAttribute('open', '');
    await expect(page.locator('.btn-back'), '?from= still points the back arrow').toHaveAttribute('href', './paycalc.html');
    // Replaced, not pushed: Back must not land on the stub, which would send the reader forward again.
    expect(await page.evaluate(() => history.length), 'the stub left an entry of its own in the history').toBe(2);

    await page.goto('/guide.html?from=trains.html#sg-getting-around');
    await page.waitForURL(/\/staff-guide\.html\?from=trains\.html#sg-getting-around$/);
    await expect(page.locator('.btn-back')).toHaveAttribute('href', './trains.html');
    expect(errors, `fatal errors: ${errors.join('; ')}`).toEqual([]);
});

test('fip: a focused country row shows its whole ring, inside the card that clips it', async ({ page }) => {
    // The card clips its content (`overflow: hidden`) and the browser's own ring is drawn outside the
    // row, so keyboard focus showed a hairline with its corners cut off.
    await page.goto('/fip-guide.html');
    const row = page.locator('#country-fr > summary');
    await row.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    const m = await row.evaluate(s => {
        const cs = getComputedStyle(s), card = getComputedStyle(/** @type {Element} */ (s.parentElement));
        return { keyboard: s.matches(':focus-visible'), style: cs.outlineStyle, width: parseFloat(cs.outlineWidth),
            offset: parseFloat(cs.outlineOffset), corner: cs.borderTopLeftRadius, cardCorner: card.borderTopLeftRadius,
            clips: card.overflow };
    });
    expect(m.keyboard).toBe(true);
    expect(m.clips, 'the card clips its row — why the ring must sit inside it').toBe('hidden');
    expect(m.style).toBe('solid');
    expect(m.width).toBeGreaterThanOrEqual(2);
    expect(m.offset + m.width, 'the ring is drawn inside the row').toBeLessThanOrEqual(0);
    expect(m.corner, 'the ringed row takes the card\'s corner, so the ring\'s own corners are not cut').toBe(m.cardCorner);
});

test('fip: the text link centres under its buttons, the no-match box keeps the column, and the note tag prints in colour', async ({ page }) => {
    // `text-align` cannot centre an inline-flex item; the desktop reading measure caught the no-match
    // <p>, a boxed callout; and the print rule that keeps the tags' colours left out `.tag-note`.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/fip-guide.html');
    const gap = await page.locator('.btn-text-link').first().evaluate(a => {
        const range = document.createRange();
        range.selectNodeContents(a);
        const t = range.getBoundingClientRect(), r = a.getBoundingClientRect();
        return { left: t.left - r.left, right: r.right - t.right };
    });
    expect(Math.abs(gap.left - gap.right), 'the link text sits in the middle of its row').toBeLessThanOrEqual(2);
    await page.locator('#countrySearch').fill('qwertyzzz');
    await expect(page.locator('#countryNoMatch')).toBeVisible();
    const [box, other] = await page.evaluate(() => [document.getElementById('countryNoMatch'), document.querySelector('.box')]
        .map(e => /** @type {Element} */ (e).getBoundingClientRect().width));
    expect(box, 'the no-match box is as wide as the page\'s other boxes').toBe(other);
    await page.emulateMedia({ media: 'print' });
    expect(await page.locator('.tag-note').first().evaluate(t => getComputedStyle(t).printColorAdjust)).toBe('exact');
});

test('staff guide: the badge grid stacks when its pair no longer fits, so larger text stays on the screen', async ({ page }) => {
    // Two `1fr` tracks could not shrink below their widest badge, so under larger text the grid
    // widened the whole column past the screen's edge — 19px at 1.5× on a 375px phone.
    for (const [w, k] of [[360, 1], [375, 1.3], [375, 1.5], [412, 1.6]]) {
        await page.setViewportSize({ width: w, height: 800 });
        await page.goto('/staff-guide.html');
        await page.evaluate(() => document.fonts.ready);
        if (k !== 1) await scaleText(page, k);
        const m = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth,
            columns: getComputedStyle(/** @type {Element} */ (document.querySelector('.badge-grid'))).gridTemplateColumns.split(' ').length }));
        expect(m.scroll, `the page's width at ${w}px, ${k}× text`).toBeLessThanOrEqual(m.width);
        if (k === 1) expect(m.columns, 'a phone keeps the pair at the default size').toBe(2);
    }
});
