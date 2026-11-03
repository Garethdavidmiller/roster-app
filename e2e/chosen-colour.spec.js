// @ts-check
/**
 * chosen-colour.spec.js — a choice is PAINTED in the colour its rule names (v25.21).
 *
 * `page-identity-parity.test.mjs` reads the stylesheets: which token each chosen rule declares, that
 * none is navy, and that Operations' type pills restate Admin's, type by type. What only a browser
 * answers is whether that rule WINS. A later rule, a more specific one, or a hover can paint over it
 * while every static check stays green — the v25.16 Links filter turned grey under the very pointer
 * that switched it on, for exactly that reason. So each case reads the painted colour off a real
 * control and compares it with the same token resolved by the same engine on the same page.
 *
 * The four surfaces are the ones v25.21 moved:
 *   · Operations' hand-entry type pills, which had been the page's orange for every type since
 *     v25.16 — a chosen AL was orange there and teal on Admin, and orange is Admin's Rest day;
 *   · the swapped-day answer, which was orange in that box and the review's green in a guarded row —
 *     three colours for one question about annual leave across two pages;
 *   · both date pickers, whose chosen day, week and range were still navy, the old "chosen";
 *   · the underline on Trains' chosen timetable column, navy for the same reason.
 * Windows High Contrast is the other half of the same release, and `forced-colors.spec.js` reads it.
 */
import { test, expect } from './fixtures.js';
import { seedSession, openRosterReview, ROSTER_REVIEW_PARSE } from './helpers.js';

/**
 * A colour expression as this page's engine resolves it, in the form getComputedStyle reports.
 * @param {import('@playwright/test').Page} page @param {string} expr
 */
function resolve(page, expr) {
    return page.evaluate(e => {
        const probe = document.createElement('i');
        probe.style.background = e;
        document.body.append(probe);
        const c = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return c;
    }, expr);
}

/**
 * A colour's HUE as the screen paints it, in degrees — sRGB bytes off a canvas. A tint is asserted to
 * be a tint OF the page's colour by hue, because comparing a rule's expression with itself cannot see
 * that the expression is wrong: mixed in oklch against `--surface`, whose own faint hue is blue,
 * Admin's gold came out pale cyan, and the first version of this file passed it.
 * @param {import('@playwright/test').Page} page @param {string} colour a computed colour
 */
function hueOf(page, colour) {
    return page.evaluate(c => {
        const ctx = /** @type {CanvasRenderingContext2D} */ (document.createElement('canvas').getContext('2d'));
        ctx.fillStyle = c;
        ctx.fillRect(0, 0, 1, 1);
        const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
        const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
        if (!d) return null;
        const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
        return (h * 60 + 360) % 360;
    }, colour);
}

/** Degrees between two hues, the short way round. @param {number|null} a @param {number|null} b */
const hueGap = (a, b) => (a === null || b === null) ? 360 : Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

/**
 * A control's painted colours, once any transition on it has finished — a reading taken mid-fade is
 * neither the old colour nor the new.
 * @param {import('@playwright/test').Locator} loc
 */
function paint(loc) {
    return loc.evaluate(el => Promise.all(el.getAnimations().map(a => a.finished)).then(() => {
        const cs = getComputedStyle(el);
        return { bg: cs.backgroundColor, image: cs.backgroundImage, fg: cs.color, shadow: cs.boxShadow };
    }));
}

test('operations: a chosen shift type wears its own colour, as on Admin, and the swap answer wears leave\'s', async ({ page }) => {
    await seedSession(page, 'G. Miller');
    await openRosterReview(page);
    const row = page.locator('.roster-change-row', { hasText: 'XZ9 GARBLED' });
    await row.locator('.roster-choice-btn--enter').click();

    // [type, chosen fill, idle words] — Admin's `.pill-<type>` and `.pill-<type>.active` tokens.
    for (const [type, fill, words] of [
        ['annual_leave', '--al', '--al-text'], ['shift', '--ot', '--ot-text'], ['rdw', '--rdw', '--rdw-text'],
        ['sick', '--absence', '--absence-text'], ['correction', '--orange-deep', '--orange-text'], ['other', '--other', '--other-text'],
    ]) {
        const pill = row.locator(`.roster-entry-pill[data-entry-type="${type}"]`);
        expect((await paint(pill)).fg, `an idle ${type} pill's words are its type's colour`).toBe(await resolve(page, `var(${words})`));
        await pill.click();
        await expect(pill).toHaveClass(/\bis-on\b/);
        // The pointer is still on the pill: a chosen control keeps its colour under it.
        const on = await paint(pill);
        expect(on.bg, `a chosen ${type} pill is filled with its type's colour, not the page's`).toBe(await resolve(page, `var(${fill})`));
        expect(on.fg).toBe(await resolve(page, 'white'));
    }

    // Leave on G. Miller's base rest day asks whether the day was swapped — a question about leave.
    await row.locator('.roster-entry-pill[data-entry-type="annual_leave"]').click();
    const swapped = row.locator('.roster-entry-swap-btn[data-entry-swap="yes"]');
    await expect(swapped, 'premise: leave on a base rest day asks the swap question').toBeVisible();
    const al = await resolve(page, 'var(--al-deep)');
    expect((await paint(swapped)).fg, 'an unanswered swap answer is written in leave\'s colour').toBe(al);
    await swapped.click();
    await expect(swapped).toHaveAttribute('aria-pressed', 'true');
    const answered = await paint(swapped);
    expect(answered.bg, 'a chosen swap answer is leave\'s colour').toBe(al);
    expect(answered.fg).toBe(await resolve(page, 'var(--surface)'));
});

test('operations: a guarded row\'s swap answer wears leave\'s colour, not the review\'s green', async ({ page }) => {
    await seedSession(page, 'G. Miller');
    // Absent on G. Miller's base rest day (Wed 5 Aug): the guard asks rather than writes.
    await openRosterReview(page, { ...ROSTER_REVIEW_PARSE, choices: {}, parsed: [{ memberName: 'G. Miller',
        shifts: { ...ROSTER_REVIEW_PARSE.parsed[0].shifts, '2026-08-05': 'SICK' } }] });
    const guarded = page.locator('.roster-change-row.roster-change-guarded');
    await expect(guarded).toHaveCount(1);
    const yes = guarded.locator('[data-swap="yes"]');
    await yes.click();
    await expect(yes).toHaveAttribute('aria-pressed', 'true');
    const on = await paint(yes);
    expect(on.bg).toBe(await resolve(page, 'var(--al-deep)'));
    expect(on.bg, 'the review\'s green is for choosing a reading of the roster, not for answering about leave')
        .not.toBe(await resolve(page, 'var(--success-green)'));
});

test('admin: the week picker\'s chosen day and week, and the leave range, wear the page\'s colour', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-08-27T09:00:00Z'));
    await seedSession(page, 'G. Miller');
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    const accent = await resolve(page, 'var(--page-accent)');
    const ink = await resolve(page, 'var(--page-accent-ink)');
    const band = await resolve(page, 'color-mix(in oklch, var(--page-accent) 20%, white)');
    const accentHue = await hueOf(page, accent);
    expect(hueGap(await hueOf(page, band), accentHue), 'the band is a tint OF the page\'s colour, on screen').toBeLessThan(15);
    expect(accent, 'premise: Admin\'s colour is not navy, so a navy chosen day would fail').not.toBe(await resolve(page, 'var(--primary-blue)'));

    await page.locator('#weekNavLabel').click();
    // In WEEK mode the chosen day is a disc of the colour drawn on the week's band — a gradient, so
    // its background-colour is transparent and the colour is in the image.
    const day = await paint(page.locator('.dp-day.dp-sel'));
    expect(day.image, 'the chosen day').toContain(accent);
    expect(day.image, 'the disc sits on the week\'s band').toContain(band);
    expect(day.fg).toBe(ink);
    const week = (await paint(page.locator('.dp-day.dp-inweek:not(.dp-sel)').first())).bg;
    expect(week, 'the rest of the chosen week').toBe(band);
    expect(hueGap(await hueOf(page, week), accentHue), `the chosen week is painted ${week} — not a tint of the page's colour`).toBeLessThan(15);
    await page.keyboard.press('Escape');
    await expect(page.locator('.dp-content')).toBeHidden();

    // The leave range: two ends in the colour, the days between in its tint.
    await page.locator('#alToggleHeader').click();
    await expect(page.locator('#alRangePicker')).toBeVisible();
    await page.locator('#alRpNext').click();
    await page.locator('#alRpGrid .rp-day[data-iso="2026-09-08"]').click();
    await page.locator('#alRpGrid .rp-day[data-iso="2026-09-11"]').click();
    for (const end of ['.rp-from', '.rp-to']) {
        const p = await paint(page.locator(`#alRpGrid ${end}`));
        expect(p.bg, `the range's ${end === '.rp-from' ? 'first' : 'last'} day`).toBe(accent);
        expect(p.fg).toBe(ink);
    }
    await expect(page.locator('#alRpGrid .rp-in-range')).toHaveCount(2);
    const inside = (await paint(page.locator('#alRpGrid .rp-in-range').first())).bg;
    expect(inside, 'a day inside the range').toBe(band);
    expect(hueGap(await hueOf(page, inside), accentHue), `a day inside the range is painted ${inside} — not a tint of the page's colour`).toBeLessThan(15);
});

test('operations: the date picker\'s chosen day wears the page\'s colour', async ({ page }) => {
    await page.addInitScript(() => { /** @type {any} */ (window).__E2E = { authUser: true, docs: [] }; });
    await seedSession(page, 'G. Miller');
    await page.goto('/operations.html');
    await page.evaluate(() => document.getElementById('circularUploadBody')?.classList.add('open'));
    await page.locator('#circularUploadBody .date-trigger').click();
    const p = await paint(page.locator('.dp-day.dp-sel'));
    expect(p.bg).toBe(await resolve(page, 'var(--page-accent)'));
    expect(p.fg).toBe(await resolve(page, 'var(--page-accent-ink)'));
});

test('trains: the chosen timetable column is underlined in the page\'s colour', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-23T09:00:00Z'));
    await seedSession(page, 'C. Reen');
    await page.goto('/trains.html');
    await page.locator('[data-view="grid"]').click();
    const oxford = page.locator('#trPattern .tr-grid-colbtn', { hasText: /^:06/ });
    await oxford.click();
    await expect(oxford).toHaveAttribute('aria-pressed', 'true');
    const head = page.locator('#trPattern .tr-grid thead th.tr-col-on').first();
    const { shadow } = await paint(head);
    const accent = await resolve(page, 'var(--page-accent)');
    expect(shadow, `the chosen column's heading is underlined in the page's colour (${accent})`).toContain(accent);
    expect(shadow).not.toContain(await resolve(page, 'var(--primary-blue)'));
});
