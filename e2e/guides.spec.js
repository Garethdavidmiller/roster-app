/**
 * guides.spec.js — the guide pages: the FIP guide and the shared guide shell.
 *
 * Split out of pages.spec.js on 3 Nov 2026, test for test and unchanged: the tests that span
 * pages, and the shared drawer, dialogs and sheets, stay there.
 */
import { readFileSync } from 'node:fs';
import { test, expect } from './fixtures.js';
import { collectFatalErrors, isTouchProject, seedMemberSession } from './helpers.js';

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
test('guides: a deep link does not pull back a reader who has moved, or a reload', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 740 });
    await holdGuideMeasurement(page);
    await landHeld(page, '/railcard-guide.html#rc-senior');
    await page.mouse.move(180, 500);
    await page.mouse.wheel(0, 30);
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

// Whole-app review, Nov 2026 (a lead from the PWA reader): every app page names its tab icon, and the
// guides named none, so a browser fell back to the ORIGIN's /favicon.ico — which neither origin has,
// and which on the Pages mirror is a different site altogether. Each guide now asks for the app's
// own icon. (paycalc-guide.html belongs to another area and is reported there.)
for (const guide of ['staff-guide', 'railcard-guide', 'fip-guide', 'rangers-guide']) {
    test(`${guide}: names the app's own tab icon, so the browser never falls back to /favicon.ico`, async ({ page }) => {
        const asked = page.waitForRequest(r => new URL(r.url()).pathname.endsWith('/icon-192.png'), { timeout: 5000 });
        await page.goto(`/${guide}.html`);
        await asked;
        await expect(page.locator('link[rel="icon"][href$="icon-192.png"]')).toHaveCount(1);
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
// multiplied, the viewport left alone — reading every size before writing any, so nested text is
// scaled once: `scaleText` (helpers.js) reads while it writes, and inherited sizes compound in it.

/** Multiply every element's font size by `k`, once. @param {import('@playwright/test').Page} page @param {number} k */
const scaleTextOnce = (page, k) => page.evaluate((k) => {
    const els = [...document.querySelectorAll('*')];
    const sizes = els.map(e => parseFloat(getComputedStyle(e).fontSize));
    els.forEach((e, i) => { if (sizes[i]) /** @type {HTMLElement} */ (e).style.fontSize = `${sizes[i] * k}px`; });
}, k);

for (const [guide, row, label] of [['rangers-guide', '.rr-row', '.rr-lbl'], ['railcard-guide', '.rc-layer', '.rc-layer-lbl']]) {
    test(`${guide}: a row's label never runs into its value under larger text`, async ({ page }) => {
        // The label columns were fixed in pixels, sized for the default text: on a phone set larger,
        // DISCOUNTS ran 10px into its value at 1.3× and MARYLEBONE 3px into its sentence.
        for (const w of [360, 390]) for (const k of [1, 1.3]) {
            await page.setViewportSize({ width: w, height: 800 });
            await page.goto(`/${guide}.html`);
            await page.evaluate(() => document.fonts.ready);
            if (k !== 1) await scaleTextOnce(page, k);
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
