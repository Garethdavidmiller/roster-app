/**
 * admin-layout.spec.js — Admin (admin.html): how the page is drawn — readable chips and badges, the
 * Unsaved bar, and the desktop audit's layout, focus and hover.
 *
 * Split by feature out of admin.spec.js on 25 Nov 2026, test for test and unchanged; what more than
 * one admin-*.spec.js file needs is in admin-helpers.js. admin.spec.js had itself been split out of
 * pages.spec.js on 3 Nov 2026; the tests that span pages, and the shared drawer, dialogs and sheets,
 * stay there.
 */
import { test, expect } from './fixtures.js';
import { seedSession, clickInView, seedMemberSession, isTouchProject, scaleText, pastDoubleTap } from './helpers.js';
import { teamMembers, getBaseShift } from '../roster-data.js';
import { deskAdmin } from './admin-helpers.js';

// ── ADMIN TOUCH LAYOUT — no horizontal blowout when a pill with hours is selected ──
// Regression: on TOUCH devices (pointer: coarse) the bulk-bar time inputs' intrinsic
// min-width (~180px each, unshrinkable without min-width: 0) stretched the whole page
// to ~585px inside a ~393px viewport the moment a pill with hours (Shift/RDW/Other)
// was selected — clipping the header, member bar, and every card at the right edge.
// Desktop never showed it (the coarse-pointer stylesheet block doesn't apply), which
// is why this must assert element widths on the Pixel-5 project, not desktop.
test('a tips panel with more below the fold says so, and stops saying it at the bottom', async ({ page }) => {
    // The fade is a MASK on a scroll container: it appears in no screenshot the suite takes (no
    // baseline captures a scrolling panel), it changes no text, and no behavioural test could
    // notice it. So the one thing that can go wrong silently — the class never being applied, or
    // never being cleared — is pinned here, in the suite that runs on every branch.
    //
    // Change a Shift is the right panel: at 390px it is ~1,100px of content in a 765px box, and it
    // is the panel a member is most likely to be reading when they need the part below the fold.
    await seedSession(page, 'G. Miller');
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto('/admin.html');
    await page.locator('.btn-card-tips').first().click();

    const panel = page.locator('#tipsLightboxContent');
    await expect(panel).toBeVisible();
    // PREMISE: this panel really does overflow. Without it the assertion below would pass happily
    // on a panel that fits, which is the same test passing for the opposite reason.
    await expect.poll(async () => panel.evaluate(el => el.scrollHeight - el.clientHeight),
        { message: 'premise: the Change a Shift tips panel overflows at 390px' })
        .toBeGreaterThan(2);
    await expect(panel).toHaveClass(/\bhas-more\b/);

    const head = () => panel.evaluate(el => {
        const p = el.getBoundingClientRect(), x = /** @type {Element} */ (el.querySelector('#tipsLightboxClose')).getBoundingClientRect(),
            t = /** @type {Element} */ (el.querySelector('#tipsLbTitle')).getBoundingClientRect();
        return { closeTop: Math.round(x.top - p.top), titleTop: Math.round(t.top - p.top), titleToBody: Math.round(
            /** @type {Element} */ (el.querySelector('#tipsLbBody')).getBoundingClientRect().top - t.bottom),
            // the still block's own band under the title: what the tips scroll beneath
            bandUnderTitle: Math.round(/** @type {Element} */ (el.querySelector('.tips-lb-top')).getBoundingClientRect().bottom - t.bottom) };
    });
    await expect.poll(() => panel.evaluate(el => el.getAnimations().length), { message: 'the panel has finished opening' }).toBe(0);
    const atRest = await head();
    await panel.evaluate(el => { el.scrollTop = el.scrollHeight; });
    // And it goes once there is nothing more to read — a fade that never clears is a panel that
    // always claims to be hiding something.
    await expect(panel).not.toHaveClass(/\bhas-more\b/);
    // THE ✕ AND THE TITLE STAYED WHERE THEY WERE (laptop polish, 13 Nov 2026): they scrolled away with the
    // tips, leaving a long panel with no title and nothing to close it but Escape or the backdrop.
    const scrolled = await head();
    expect({ closeTop: scrolled.closeTop, titleTop: scrolled.titleTop }, 'the ✕ and the title do not move as the tips scroll')
        .toEqual({ closeTop: atRest.closeTop, titleTop: atRest.titleTop });
    expect(atRest.titleToBody, 'at rest the title keeps its gap above the tips').toBeGreaterThanOrEqual(15);
    expect(atRest.closeTop, 'and the ✕ sits where it always did, 14px from the top').toBe(14);
    expect(scrolled.bandUnderTitle, 'the tips scroll under a band below the title, not up against it').toBeGreaterThanOrEqual(15);
    await page.locator('#tipsLightboxClose').click();
    await expect(page.locator('#tipsLightbox')).toBeHidden();
});

// The collapsed AL card's one figure at 1–5 days left was brand gold on the chip's near-white ground,
// 1.69:1, while the banner inside the same card said the same thing in the darkened `--al-low`. No
// scan reached the state, so it is driven for real: 29 days of leave on days he is rostered to work.
test('admin: the leave-left chip in the card header is readable when only a few days remain', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-11-05T09:00:00Z'));
    await seedSession(page, 'G. Miller');
    const me = teamMembers.find(/** @param {any} m */ m => m.name === 'G. Miller');
    /** @type {string[]} */
    const days = [];
    for (const d = new Date('2026-01-05T12:00:00'); days.length < 29; d.setDate(d.getDate() + 1)) {
        const s = getBaseShift(me, d);
        if (d.getDay() !== 0 && s && s !== 'RD' && s !== 'OFF') days.push(d.toISOString().slice(0, 10));
    }
    await page.addInitScript((docs) => {
        /** @type {any} */ (window).__E2E = Object.assign(/** @type {any} */ (window).__E2E || {}, { docs });
    }, days.map((date, i) => ({ id: `al${i}`, memberName: 'G. Miller', date, type: 'annual_leave', value: 'AL', note: '' })));
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    await page.locator('#fieldMember').selectOption('G. Miller');
    const chip = page.locator('#alHeaderBalance');
    await expect(chip, 'premise: 1–5 days left').toHaveClass(/\bbalance-low\b/);
    const ratio = await chip.evaluate(el => {
        const ctx = /** @type {CanvasRenderingContext2D} */ (document.createElement('canvas').getContext('2d', { willReadFrequently: true }));
        /** Any CSS colour → sRGB, by painting it (resolves oklch and color-mix). @param {string} css */
        const rgb = (css) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = css; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3); };
        /** @param {number[]} c */
        const lum = (c) => c.map(v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; })
            .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
        const cs = getComputedStyle(el);
        const [hi, lo] = [lum(rgb(cs.color)), lum(rgb(cs.backgroundColor))].sort((x, y) => y - x);
        return (hi + 0.05) / (lo + 0.05);
    });
    expect(ratio, '"2026: N left" at a low balance is under the 4.5:1 text floor').toBeGreaterThanOrEqual(4.5);
});

// Staging a saved change's removal puts "Removing" in the badge beside its date, in the badge's own
// colours — which were white on the bright orange, 2.16:1, the one pairing css-tokens.md forbids. The
// a11y scan never stages a removal. Since the owner's 10 Nov 2026 decision a tick on a saved row only
// selects it; a saved change is removed by selecting its own type again (admin-week-editor.js, the
// checkbox handler).
test('admin: the "Removing" badge on a saved day staged for removal is readable', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-11-10T09:00:00Z'));
    await seedSession(page, 'G. Miller');
    await page.addInitScript(() => {
        /** @type {any} */ (window).__E2E = Object.assign(/** @type {any} */ (window).__E2E || {}, {
            docs: [{ id: 'o1', memberName: 'G. Miller', date: '2026-11-12', type: 'rdw', value: '13:30-21:00', note: '' }],
        });
    });
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    await page.locator('#fieldMember').selectOption('G. Miller');
    const row = page.locator('.week-panel .day-row[data-date="2026-11-12"]');
    await expect(row.locator('.overwrite-badge')).toContainText('Saved');
    await row.locator('.type-pill-btn[data-type="rdw"]').click();
    const badge = row.locator('.overwrite-badge');
    await expect(badge).toContainText('Removing');
    const ratio = await badge.evaluate(async el => {
        await Promise.all(el.getAnimations().map(a => a.finished));   // its fill eases between states
        const ctx = /** @type {CanvasRenderingContext2D} */ (document.createElement('canvas').getContext('2d', { willReadFrequently: true }));
        /** @param {string} css */
        const rgb = (css) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = css; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3); };
        /** @param {number[]} c */
        const lum = (c) => c.map(v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; })
            .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
        const cs = getComputedStyle(el);
        const [hi, lo] = [lum(rgb(cs.color)), lum(rgb(cs.backgroundColor))].sort((x, y) => y - x);
        return (hi + 0.05) / (lo + 0.05);
    });
    expect(ratio, 'the "Removing" badge is under the 4.5:1 text floor').toBeGreaterThanOrEqual(4.5);
});

// A failed read shows two Retries at once — Saved Changes' and the week grid's, the second added
// "because this is the card they are looking at" — and only the first was styled: the rule was scoped
// to `.override-state`, so the week grid's rendered as plain grey text with no pointer.
test('admin: the week grid\'s Retry looks like Saved Changes\' Retry', async ({ page }) => {
    await seedSession(page, 'G. Miller');
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    const other = await page.locator('#fieldMember').evaluate((el) => {
        const sel = /** @type {HTMLSelectElement} */ (el);
        return [...sel.options].find(o => o.value && o.value !== sel.value)?.value ?? '';
    });
    await page.evaluate(() => { /** @type {any} */ (window).__E2E.failGetDocs = true; });
    await page.locator('#fieldMember').selectOption(other);
    const week = page.locator('#retryWeekLink'), list = page.locator('#retryLoadLink');
    await expect(week, 'premise: the week grid offers a Retry').toHaveCount(1, { timeout: 10000 });
    await expect(list, 'premise: Saved Changes offers one too').toHaveCount(1);
    const look = (/** @type {import('@playwright/test').Locator} */ l) => l.evaluate(el => {
        const c = getComputedStyle(el);
        return [c.color, c.cursor, c.textDecorationLine, c.fontWeight, c.fontSize].join(' | ');
    });
    expect(await look(week)).toBe(await look(list));
});

// With "reduce motion" on, the drawer, every lightbox and the notices appear without moving — and the
// over-limit confirm bar still slid up its full height while the save toast rose 20px.
test('admin: with reduce motion on, the over-limit bar and the save toast appear without sliding', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await seedSession(page, 'G. Miller');
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    const moving = await page.evaluate(() => ['alConfirmBar', 'saveToast'].map(id => {
        const el = /** @type {HTMLElement} */ (document.getElementById(id));
        el.classList.add('visible');
        const n = el.getAnimations().length;   // flushes style, so a transition that just started is counted
        el.classList.remove('visible');
        return [id, n];
    }));
    for (const [id, n] of moving) expect(n, `#${id} still animates its entrance with reduce motion on`).toBe(0);
});

// The save toast and the Unsaved bar share the foot of the screen, and the toast was drawn over the bar's
// label and both of its buttons for four seconds, with taps passing through to buttons nobody could see
// (css-admin-ops-10). Apply no longer raises the toast (admin-1: it confirms a SAVE), so the case left is
// a recorded booking deleted while week edits are staged; with nothing staged the toast keeps its place.
for (const staged of [true, false]) {
    test(`admin: a delete's toast ${staged ? 'rises clear of the Unsaved bar' : 'keeps its place at the foot with nothing staged'}`, async ({ page }) => {
        await page.clock.setFixedTime(new Date('2026-11-10T09:00:00Z'));
        await seedMemberSession(page, 'G. Miller');   // a real user, so the delete is not refused
        await page.addInitScript(() => {
            /** @type {any} */ (window).__E2E = Object.assign(/** @type {any} */ (window).__E2E || {}, {
                docs: [{ id: 'a1', memberName: 'G. Miller', date: '2026-03-02', type: 'annual_leave', value: 'AL', note: '' }],
            });
        });
        await page.setViewportSize({ width: 375, height: 800 });
        await page.goto('/admin.html');
        await page.waitForSelector('.day-row', { timeout: 10000 });
        await page.locator('#fieldMember').selectOption('G. Miller');
        if (staged) {
            const row = page.locator('.week-panel .day-row[data-date="2026-11-10"]');
            await row.locator('.col-check input').click();
            await row.locator('.type-pill-btn[data-type="annual_leave"]').click();
        }
        await expect(page.locator('#stagedBar'), 'premise: the Unsaved bar is up only with an edit staged')[staged ? 'toBeVisible' : 'toBeHidden']();
        await page.locator('#alToggleHeader').click();
        await page.locator('#alBookedToggle').click();
        const del = page.locator('#alBookedBody .btn-period-delete').first();
        await del.click();
        await pastDoubleTap(page);
        await del.click();
        const toast = page.locator('#saveToast');
        await expect(toast, 'premise: the delete raised the toast').toHaveClass(/\bvisible\b/);
        const g = await toast.evaluate(async el => {
            await Promise.all(el.getAnimations().map(a => a.finished));   // it rises as it appears
            const bar = /** @type {HTMLElement} */ (document.getElementById('stagedBar'));
            return { toast: el.getBoundingClientRect().bottom, bar: bar.hidden ? null : bar.getBoundingClientRect().top,
                     foot: window.innerHeight };
        });
        if (staged) expect(g.toast, 'the toast is drawn over the Unsaved bar').toBeLessThanOrEqual(/** @type {number} */ (g.bar));
        else expect(g.foot - g.toast, 'with no bar to clear, the toast sits 24px from the foot').toBeCloseTo(24, 0);
    });
}

// "Unsaved: 2 days, 1 to remove" was `nowrap` and could not shrink, so at 360px the bar's Save button
// ran 22px off the screen — and with Android's large text, the plain "N days" state did the same.
test('admin: the Unsaved bar keeps Discard and Save on a 360px screen, removals staged, text large', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-11-10T09:00:00Z'));
    await seedSession(page, 'G. Miller');
    await page.addInitScript(() => {
        /** @type {any} */ (window).__E2E = Object.assign(/** @type {any} */ (window).__E2E || {}, {
            docs: [{ id: 'o1', memberName: 'G. Miller', date: '2026-11-12', type: 'rdw', value: '13:30-21:00', note: '' }],
        });
    });
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    await page.locator('#fieldMember').selectOption('G. Miller');
    // 1 to remove. Since the owner's 10 Nov 2026 decision a tick on a saved row only selects it; a saved
    // change is removed by selecting its own type again (admin-week-editor.js, the checkbox handler).
    await page.locator('.week-panel .day-row[data-date="2026-11-12"] .type-pill-btn[data-type="rdw"]').click();
    for (const d of ['2026-11-10', '2026-11-11']) {
        const row = page.locator(`.week-panel .day-row[data-date="${d}"]`);
        await row.locator('.col-check input').click();
        await row.locator('.type-pill-btn[data-type="annual_leave"]').click();
    }
    await expect(page.locator('#stagedCount')).toHaveText('2 days, 1 to remove');
    const fit = () => page.evaluate(() => {
        const label = /** @type {HTMLElement} */ (document.querySelector('.staged-bar-label'));
        return { vw: document.documentElement.clientWidth, labelOverflow: label.scrollWidth - label.clientWidth,
            buttons: ['stagedDiscardBtn', 'stagedSaveBtn'].map(id => [id, Math.round(/** @type {HTMLElement} */ (document.getElementById(id)).getBoundingClientRect().right)]) };
    });
    for (const scale of [1, 1.3]) {
        if (scale !== 1) await scaleText(page, scale);
        const f = await fit();
        for (const [id, right] of f.buttons) expect(right, `${id} runs off the screen at ${scale}× text`).toBeLessThanOrEqual(f.vw);
        expect(f.labelOverflow, `"Unsaved: …" runs out of its own box, under the buttons, at ${scale}× text`).toBeLessThanOrEqual(0);
    }
});

test('admin: a Saved Changes row is one row — controls side by side, under 64px', async ({ page }) => {
    await seedSession(page, 'G. Miller');
    await page.addInitScript(() => {
        /** @type {any} */ (window).__E2E = Object.assign(/** @type {any} */ (window).__E2E || {}, {
            docs: [
                { id: 'a', memberName: 'G. Miller', date: '2026-09-01', type: 'sick',  value: 'SICK', note: '' },
                { id: 'b', memberName: 'G. Miller', date: '2026-09-08', type: 'shift', value: '15:15-23:55', note: '' },
            ],
        });
    });
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    await page.locator('#fieldMember').selectOption('G. Miller');
    await page.locator('#overridesToggleHeader').click();
    // The list is newest first (whole-app check, 10 Nov 2026 — it had been in whatever order the
    // member's read arrived), so the 1 September row is found by its date, not by its place.
    await expect(page.locator('.override-card .btn-edit').first(), 'newest first').toHaveAttribute('data-date', '2026-09-08');
    const card = page.locator('.override-card').filter({ has: page.locator('.btn-edit[data-date="2026-09-01"]') });
    await expect(card).toBeVisible();

    const g = await card.evaluate(el => {
        const r = sel => /** @type {HTMLElement} */ (el.querySelector(sel)).getBoundingClientRect();
        return {
            row:   Math.round(el.getBoundingClientRect().height),
            dir:   getComputedStyle(/** @type {HTMLElement} */ (el.querySelector('.oc-actions'))).flexDirection,
            edit:  r('.btn-edit'), del: r('.btn-delete'),
        };
    });
    expect(g.dir, 'Edit and Delete sit side by side').toBe('row');
    expect(g.edit.height, 'Edit keeps its 44px target').toBeGreaterThanOrEqual(44);
    expect(g.del.height,  'Delete keeps its 44px target').toBeGreaterThanOrEqual(44);
    expect(Math.abs(g.edit.top - g.del.top), 'and they share a line').toBeLessThan(2);
    expect(g.row, 'the row is sized by its content, not a stacked control cluster').toBeLessThan(64);

    // The controls kept their names — the glyph alone has none — and say the date as the row does.
    await expect(card.locator('.btn-edit')).toHaveAttribute('aria-label', /^Edit G\. Miller 1 September 2026$/);
    await expect(card.locator('.btn-delete')).toHaveAttribute('aria-label', /^Delete G\. Miller 1 September 2026$/);

    // One member on screen: the name is not repeated on every row…
    await expect(card.locator('.oc-member')).toBeHidden();
    // …and returns for All staff, where it is what tells the rows apart.
    await page.locator('#showAllOverridesBtn').click();
    await expect(page.locator('#showAllOverridesBtn')).toHaveText('This member only');
    await expect(page.locator('.override-card').first().locator('.oc-member')).toBeVisible();
});

// ── "TODAY" AND "✓ SAVED" ON ONE DATE LINE (polish pass, owner report from a Galaxy) ─────────────
// A row that is both today and already saved carries two chips on its date line, and under Android
// text scaling that line wraps. As inline text the saved badge's vertical padding did not count
// towards its line, so the wrapped chip sat directly under "Today" — measured 0.17px apart at 390px
// and the owner's ~1.11× text, 1.09px at 412px / 1.3×. The date line is now a wrapping flex row with
// a row gap. Asserted as GEOMETRY because both chips are present and correct either way: nothing
// but their boxes can tell a clear gap from two chips touching. Run at 1.3×, not 1.11×: at 390px the
// 1.11× line wraps by 1.2px of text width, which CI's Chromium drew narrower, so the chips sat on one
// line and there was no gap to measure (10 Nov 2026). At 1.3× they need 21px more than the line has,
// and the old `display: block` line still puts them 0.4px apart.
test('admin: a row that is today AND saved keeps a clear gap between its two chips when they wrap', async ({ page }, testInfo) => {
    test.skip(!isTouchProject(testInfo), 'the stacked date line is the touch layout');
    await page.clock.setFixedTime(new Date('2026-07-15T09:00:00Z'));
    await page.setViewportSize({ width: 390, height: 900 });
    await seedSession(page, 'G. Miller');
    await page.addInitScript(() => {
        /** @type {any} */ (window).__E2E = { authUser: true,
            docs: [{ id: 't1', memberName: 'G. Miller', date: '2026-07-15', type: 'rdw', value: '14:45-23:55', note: '' }] };
    });
    await page.goto('/admin.html');
    await page.locator('#fieldMember').selectOption('G. Miller');
    const row = page.locator('.week-panel .day-row.today');
    await expect(row.locator('.overwrite-badge')).toBeVisible();
    await scaleText(page, 1.3);
    const g = await row.evaluate((r) => {
        const t = /** @type {Element} */ (r.querySelector('.day-today-tag')).getBoundingClientRect();
        const b = /** @type {Element} */ (r.querySelector('.overwrite-badge')).getBoundingClientRect();
        return { wrapped: b.top >= t.bottom - 1, gap: b.top - t.bottom };
    });
    expect(g.wrapped, 'the fixture must actually wrap the two chips, or the gap proves nothing').toBe(true);
    expect(g.gap, 'the wrapped saved chip must not touch the Today chip').toBeGreaterThanOrEqual(3);
});

// ── THE DESKTOP AUDIT (Nov 2026) ─────────────────────────────────────────────────────────────────
//
// Admin is the page most used at a desk, and the audit measured it at the station PC's sizes
// (1366×768, 1536×864, 1920×1080) rather than at the phone width every earlier pass started from. Each
// test below is GEOMETRY or a computed style read off the rendered page, because every one of these
// defects was invisible to a behavioural assertion: the DOM said the right thing while the pixels hid
// it, squashed it or put it 400px from where the reader was looking. Desktop-only where the subject is
// a mouse or a wide window; a phone's own layout is held by the tests above.

/** A token's resolved colour, serialised as the page serialises an outline that uses it.
 *  @param {import('@playwright/test').Page} page @param {string} name */
const tokenColour = (page, name) => page.evaluate((n) => {
    const el = document.createElement('i'); el.style.color = `var(${n})`; document.body.append(el);
    const c = getComputedStyle(el).color; el.remove(); return c;
}, name);

/** Wait until `loc` has no transition running — two frames first, so a change the last input has
 *  only just caused (a hover, a class) has had the chance to START. A read taken mid-transition, or
 *  before one begins, sees neither state, and a check that something did NOT change passes on it.
 *  @param {import('@playwright/test').Locator} loc */
async function settled(loc) {
    await loc.page().evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    await expect.poll(() => loc.evaluate(el => el.getAnimations().length), { message: 'its transitions finish' }).toBe(0);
    return loc;
}

test('admin: the side column SCROLLS to the Record button, rather than squashing its cards (1366×768)', async ({ page }, info) => {
    // A `.card` is `overflow: hidden`, so as a flex item its automatic minimum height is 0: the sticky
    // column shrank its cards to fit itself and never overflowed. With Record Annual Leave open the
    // Record button was cut off below a clipped card — 175px of it at this size — with nothing to
    // scroll, and the wheel moved nothing. `elementFromPoint` is the honest reading: a button can be
    // in the DOM, enabled and "visible", and still not be what a click there would hit.
    test.skip(isTouchProject(info), 'the sticky two-column layout and a mouse wheel');
    await deskAdmin(page, { width: 1366, height: 768 });
    await page.locator('#alToggleHeader').click();
    await expect(page.locator('#alRangePicker')).toBeVisible();
    const side = page.locator('.col-side');
    expect(await side.evaluate(el => el.scrollHeight - el.clientHeight),
        'the open card makes the column taller than the window, so it must overflow — not squash').toBeGreaterThan(50);
    // …AND IT SAYS SO (laptop polish, 13 Nov 2026): nothing showed that the column scrolls, and on a Mac
    // the overlay scrollbar stays hidden until used. The fade every scrolling panel wears, until the end.
    const fade = () => side.evaluate(el => ({ more: el.classList.contains('has-more'), mask: getComputedStyle(el).maskImage }));
    await expect.poll(fade, { message: 'the column fades at its foot while there is more below' })
        .toEqual({ more: true, mask: expect.stringContaining('linear-gradient') });
    const box = /** @type {{x:number,y:number,width:number,height:number}} */ (await side.boundingBox());
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 2000);
    await expect.poll(fade, { message: 'and stops fading once the end is reached' }).toEqual({ more: false, mask: 'none' });
    await expect.poll(() => page.evaluate(() => {
        const b = /** @type {HTMLElement} */ (document.getElementById('alSaveBtn')).getBoundingClientRect();
        const s = /** @type {HTMLElement} */ (document.querySelector('.col-side')).getBoundingClientRect();
        const hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
        return { inColumn: b.top >= s.top - 1 && b.bottom <= s.bottom + 1, inWindow: b.bottom <= innerHeight, hit: hit?.id ?? '' };
    }), { message: 'after the wheel the Record button is in view, and is what a click there hits' })
        .toEqual({ inColumn: true, inWindow: true, hit: 'alSaveBtn' });
    // Every card keeps its own height: none is clipped by its own `overflow: hidden`.
    const clipped = await page.evaluate(() => [...document.querySelectorAll('.col-side > .card')]
        .filter(c => c.scrollHeight - c.clientHeight > 1).map(c => c.id));
    expect(clipped, 'a card in the side column is squashed below its content').toEqual([]);
});

// A SHORT LAPTOP WINDOW SHOWS THE WEEK, NOT JUST ITS CONTROLS (laptop polish, 13 Nov 2026). At 1280×593 —
// a 1920-pixel laptop at Windows' 150% — 474px stood above Sunday and the window showed two days of seven.
// The bulk bar and the rows were sized for a tall desk and a thumb; with a mouse on a short window the
// spacing tightens (no control moves) and a row is 42px, so three days show at 593 and four at 650.
for (const [width, height, days] of /** @type {const} */ ([[1280, 593, 3], [1366, 650, 4]])) {
    test(`admin laptop: the opening screen shows ${days} days of the week at ${width}×${height}`, async ({ page }, info) => {
        test.skip(isTouchProject(info), 'a laptop window and a mouse');
        await deskAdmin(page, { width, height });
        const g = await page.evaluate(() => {
            const rows = [...document.querySelectorAll('.day-row')];
            return { whole: rows.filter(r => r.getBoundingClientRect().bottom <= innerHeight).length,
                rowH: rows[0].getBoundingClientRect().height };
        });
        expect(g.whole, 'whole days on the opening screen').toBeGreaterThanOrEqual(days);
        expect(g.rowH, 'a row sized for a mouse, not a thumb').toBeLessThanOrEqual(43);
    });
}

test('admin: a save error is never under the Unsaved bar — scrolled to, or at the very end of the page (1366×768)', async ({ page }, info) => {
    // The bar is fixed over the foot of the screen and nothing reserved its height: the save error,
    // brought into view with block: 'nearest', stopped exactly behind it, and at the end of the page
    // there was nowhere further to scroll. The row turned red and the reason was hidden.
    test.skip(isTouchProject(info), 'a desk-sized window; the phone has the same reserve but its own layout');
    await deskAdmin(page, { width: 1366, height: 768 });
    const tue = page.locator('.day-row[data-date="2026-07-14"]');
    await tue.locator('label.col-day').click();
    await tue.locator('.pill-shift').click();
    await tue.locator('.day-start').fill('');
    await tue.locator('.day-end').fill('');
    await page.locator('#stagedSaveBtn').click();
    const feedback = page.locator('#formFeedback');
    await expect(feedback).toContainText('fill in the start and end time');
    const gap = () => page.evaluate(() => {
        const f = /** @type {HTMLElement} */ (document.getElementById('formFeedback')).getBoundingClientRect();
        const bar = /** @type {HTMLElement} */ (document.getElementById('stagedBar')).getBoundingClientRect();
        return Math.round(bar.top - f.bottom);
    });
    await expect.poll(gap, { message: 'the message, scrolled to, ends above the bar' }).toBeGreaterThanOrEqual(0);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect.poll(gap, { message: 'and at the end of the page it still clears the bar' }).toBeGreaterThanOrEqual(0);
});

// APPLY IS GREYED OUT UNTIL IT CAN ACT, AND SAYS WHY (owner, Nov 2026). The audit above left Apply live,
// refusing a press with something missing in a line under it; the owner chose Save changes' own pattern
// instead — greyed out until it can do something, the reason in the line beneath. A phone and a desk
// alike, so this runs on both projects. The Sunday refusal below is the one a press still finds.
test('admin: Apply is greyed out until a day is ticked AND a type is chosen, and the line under it says which is missing', async ({ page }, info) => {
    await deskAdmin(page, isTouchProject(info) ? { width: 393, height: 851 } : { width: 1366, height: 768 });
    const apply = page.locator('#bulkApplyBtn');
    const why = page.locator('#bulkApplyHint');
    const al = page.locator('#bulkTypePills .pill-annual_leave');
    // Nothing ticked, no type: greyed out the way Save changes is, which nothing is staged for either.
    await expect(apply).toBeDisabled();
    await expect(why).toHaveText('Tick at least one day and choose a type');
    await expect(page.locator('#saveBtn'), 'premise: Save changes is greyed out too').toBeDisabled();
    const look = (/** @type {string} */ sel) => page.locator(sel).evaluate(el => ({ opacity: getComputedStyle(el).opacity, cursor: getComputedStyle(el).cursor }));
    expect(await look('#bulkApplyBtn'), 'Save\'s own disabled look, not a new one').toEqual(await look('#saveBtn'));
    // A screen reader reads the reason straight after the button, as it does Save's.
    const tree = (await page.locator('#bulkBar').ariaSnapshot()).split('\n').map(l => l.trim());
    const at = tree.findIndex(l => l.startsWith('- button "3 Apply to ticked days" [disabled]'));
    expect(at, 'Apply is in the tree, unavailable').toBeGreaterThan(-1);
    expect(tree[at + 1], 'and the next thing read is why').toBe('- paragraph: Tick at least one day and choose a type');
    // The line sits under the button, at its left edge — not centred under the bar.
    const geo = await page.evaluate(() => {
        const a = /** @type {HTMLElement} */ (document.getElementById('bulkApplyBtn')).getBoundingClientRect();
        const h = /** @type {HTMLElement} */ (document.getElementById('bulkApplyHint'));
        const r = document.createRange(); r.selectNodeContents(h); const t = r.getBoundingClientRect();
        return { below: Math.round(t.top - a.bottom), left: Math.round(t.left - a.left) };
    });
    expect(geo.below, 'directly under Apply').toBeGreaterThanOrEqual(0);
    expect(geo.below, 'directly under Apply').toBeLessThan(16);
    expect(Math.abs(geo.left), 'starting where Apply starts').toBeLessThanOrEqual(1);

    // A type, nothing ticked.
    await clickInView(al);
    await expect(apply).toBeDisabled();
    await expect(why).toHaveText('Tick the days to apply it to');
    await clickInView(al);   // the same pill again puts the type back
    await expect(why).toHaveText('Tick at least one day and choose a type');
    // Days ticked, no type — one by its own box, then a whole run.
    await clickInView(page.locator('.day-row[data-date="2026-07-14"] .day-cb'));
    await expect(apply).toBeDisabled();
    await expect(why).toHaveText('Choose a type for the ticked day');
    await clickInView(page.locator('#bulkSelMonFri'));
    await expect(why).toHaveText('Choose a type for the ticked days');
    await expect(apply).toBeDisabled();
    // Both: it can act, and the line goes quiet, as Save's does when there is something to save.
    await clickInView(al);
    await expect(apply).toBeEnabled();
    await expect(apply).toContainText('Apply “Annual Leave” to ticked days');
    await expect(why).toHaveText('');
    // …and it really applies: the five weekdays take the leave, the weekend does not.
    await clickInView(apply);
    const staged = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.day-row')]
        .map(r => [/** @type {HTMLElement} */ (r).dataset.date, /** @type {HTMLElement} */ (r).dataset.type || ''])));
    expect(staged).toEqual({ '2026-07-12': '', '2026-07-13': 'annual_leave', '2026-07-14': 'annual_leave',
        '2026-07-15': 'annual_leave', '2026-07-16': 'annual_leave', '2026-07-17': 'annual_leave', '2026-07-18': '' });
    await expect(page.locator('#saveBtn')).toBeEnabled();
    await expect(apply, 'the days are still ticked and the type still chosen').toBeEnabled();
});

// A row's own pill can untick it — pressing the chosen type again takes the row back to nothing — and the
// bar follows. Its count was read only when a box or a bulk button changed, so it went on counting a day
// no longer ticked; with Apply's state read from the same count, that would leave Apply live over nothing.
test('admin: a day unticked by its own pill leaves the bulk bar\'s count, and Apply', async ({ page }, info) => {
    await deskAdmin(page, isTouchProject(info) ? { width: 393, height: 851 } : { width: 1366, height: 768 });
    const tue = page.locator('.day-row[data-date="2026-07-14"]');
    await clickInView(tue.locator('.day-cb'));
    await clickInView(page.locator('#bulkTypePills .pill-rdw'));
    await expect(page.locator('#bulkSelCount')).toHaveText('1 day selected');
    await expect(page.locator('#bulkApplyBtn'), 'premise: a ticked day and a type').toBeEnabled();
    await clickInView(tue.locator('.pill-annual_leave'));
    await clickInView(tue.locator('.pill-annual_leave'));   // pressed again: the row goes back to nothing
    await expect(tue.locator('.day-cb'), 'premise: the row\'s own pill unticked it').not.toBeChecked();
    await expect(page.locator('#bulkSelCount'), 'the count follows the row').toHaveText('');
    await expect(page.locator('#bulkApplyBtn'), 'and Apply has nothing to act on').toBeDisabled();
    await expect(page.locator('#bulkApplyHint')).toHaveText('Tick the days to apply it to');
});

test('admin: a Sunday a type cannot go on greys Apply out too — the reason under it, before any press — and a working day beside it brings Apply back', async ({ page }, info) => {
    // The last refusal only a press used to find (owner, 8 Nov 2026): AL, Absent and Shift skip a Sunday
    // (the Sunday rule's layer 2), so a week whose only ticked day is the Sunday had nothing to apply,
    // and Apply looked ready until it was pressed. It is known before the press, so it is said before
    // it, the way the rest of Apply's reasons are (admin-bulk-apply.js). Layer 2 itself is unchanged: a
    // Sunday ticked among working days is still skipped by the apply, and the receipt says so.
    test.skip(isTouchProject(info), 'a desk-sized window');
    await deskAdmin(page, { width: 1366, height: 768 });
    const apply = page.locator('#bulkApplyBtn');
    const hint = page.locator('#bulkApplyHint');
    const sunday = page.locator('.day-row[data-date="2026-07-12"]');
    const monday = page.locator('.day-row[data-date="2026-07-13"]');
    await sunday.locator('.day-cb').check();
    await page.locator('#bulkTypePills .pill-annual_leave').click();
    await expect(apply, 'only a Sunday ticked, and AL cannot go on one').toBeDisabled();
    await expect(hint).toHaveText('Sunday isn’t a contracted day — tick a working day');
    await page.locator('#bulkTypePills .pill-rdw').click();
    await expect(apply, 'RDW can: a worked Sunday is RDW').toBeEnabled();
    await expect(hint).toHaveText('');
    await page.locator('#bulkTypePills .pill-sick').click();
    await expect(apply, 'nor can Absent').toBeDisabled();
    await page.locator('#bulkTypePills .pill-annual_leave').click();
    await monday.locator('.day-cb').check();
    await expect(apply, 'a working day ticked beside it: there is something to apply').toBeEnabled();
    await expect(hint).toHaveText('');
    await apply.click();
    await expect(monday, 'the working day is staged').toHaveAttribute('data-type', 'annual_leave');
    await expect(sunday, 'layer 2: nothing was staged on the Sunday').not.toHaveAttribute('data-type', /./);
    await expect(page.locator('#formFeedback'), 'and the receipt says the Sunday was skipped').toContainText('Sunday skipped');
});

test('admin: every focus ring stands out from what is behind it — navy on the card, gold on the navy bar', async ({ page }, info) => {
    // Gold is ~1.5:1 on a light surface, under the 3:1 a focus indicator needs, and around the gold
    // Today button it vanished outright; the navy ring on the Unsaved bar's Save was navy on navy. A
    // ring is drawn only for a keyboard, so no screenshot sees it: this reads the outline each control
    // actually gets, against the token for the surface it is drawn on.
    test.skip(isTouchProject(info), 'a keyboard ring');
    await deskAdmin(page, { width: 1366, height: 900 });
    const navy = await tokenColour(page, '--primary-blue');
    const gold = await tokenColour(page, '--accent-gold');
    // Stage something with the mouse first, so the Unsaved bar is up — then switch to the keyboard,
    // because `:focus-visible` follows the last input the reader used.
    const tue = page.locator('.day-row[data-date="2026-07-14"]');
    await tue.locator('label.col-day').click();
    await tue.locator('.pill-annual_leave').click();
    await expect(page.locator('#stagedBar')).toBeVisible();
    // …and a bulk type, because Apply is greyed out — out of the Tab order — until it can act (owner,
    // Nov 2026), and a ring is drawn only on a control that can take focus.
    await page.locator('#bulkTypePills .pill-rdw').click();
    await expect(page.locator('#bulkApplyBtn')).toBeEnabled();
    // A real Tab, so the focused control matches :focus-visible. WebKit hands a SCRIPTED focus() the
    // previous element's focus-visible state, and the last focus came from a click.
    await page.locator('#navMenuBtn').focus();
    await page.keyboard.press('Tab');
    /** @param {string} sel */
    const ring = async (sel) => {
        const loc = page.locator(sel);
        await loc.focus();
        return loc.evaluate(el => ({ visible: el.matches(':focus-visible'), style: getComputedStyle(el).outlineStyle, colour: getComputedStyle(el).outlineColor }));
    };
    for (const sel of ['#prevWeekBtn', '#nextWeekBtn', '#thisWeekBtn', '#bulkApplyBtn']) {
        expect(await ring(sel), `${sel} sits on the light card: its ring is navy`).toEqual({ visible: true, style: 'solid', colour: navy });
    }
    for (const sel of ['#stagedDiscardBtn', '#stagedSaveBtn']) {
        expect(await ring(sel), `${sel} sits on the navy bar: its ring is gold`).toEqual({ visible: true, style: 'solid', colour: gold });
    }
    // The week picker's month arrows are on its white panel (shared.css).
    await page.locator('#weekNavLabel').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.dp-content')).toBeVisible();
    // …and wait for its opening frame (flaky under load until 25 Nov 2026). `createLightbox` shows the picker at once
    // but moves focus into it — onto the chosen day — in the next animation frame, the frame that also adds `.open`.
    // On a loaded machine that frame came after the `focus()` below, took the focus back to the day, and #dpPrev
    // read as not focus-visible. With `.open` on, the picker's own focus move has been made.
    await expect(page.locator('.dp-overlay')).toHaveClass(/\bopen\b/);
    for (const sel of ['#dpPrev', '#dpNext']) {
        expect(await ring(sel), `${sel} sits on the picker's white panel: its ring is navy`).toEqual({ visible: true, style: 'solid', colour: navy });
    }
});

test('admin: on a wide screen the Unsaved bar and the unsaved-changes banner keep their buttons over the page', async ({ page }, info) => {
    // At 1920 the bar's buttons sat at x=1701–1904 and the banner's the same — ~400px right of the
    // 1100px page, at the window's edge. The bar itself still spans the window; its CONTENT keeps to
    // the band, as the AL over-limit bar's already did.
    test.skip(isTouchProject(info), 'a wide window');
    await deskAdmin(page, { width: 1920, height: 1080 });
    const tue = page.locator('.day-row[data-date="2026-07-14"]');
    await tue.locator('label.col-day').click();
    await tue.locator('.pill-annual_leave').click();
    await expect(page.locator('#stagedBar')).toBeVisible();
    /** @param {string} sel */
    const within = (sel) => page.evaluate((s) => {
        const c = /** @type {HTMLElement} */ (document.querySelector('main.container')).getBoundingClientRect();
        const r = /** @type {HTMLElement} */ (document.querySelector(s)).getBoundingClientRect();
        return { left: Math.round(r.left - c.left), right: Math.round(c.right - r.right) };
    }, sel);
    for (const sel of ['.staged-bar-label', '.staged-bar-btns']) {
        const m = await within(sel);
        expect(m.left, `${sel} starts inside the page`).toBeGreaterThanOrEqual(0);
        expect(m.right, `${sel} ends inside the page`).toBeGreaterThanOrEqual(0);
    }
    // The banner: a week change with that staged edit asks first.
    await page.locator('#prevWeekBtn').click();
    await expect(page.locator('#unsavedBanner')).toBeVisible();
    const banner = await within('.unsaved-banner-btns');
    expect(banner.right, 'the banner\'s buttons end inside the page').toBeGreaterThanOrEqual(0);
    expect(banner.left, 'the banner\'s buttons start inside the page').toBeGreaterThanOrEqual(0);
});

test('admin: the unsaved-changes banner closes on Escape and keeps the edit; the Unsaved bar is the last Tab stop, not the first', async ({ page }, info) => {
    test.skip(isTouchProject(info), 'a keyboard');
    await deskAdmin(page, { width: 1366, height: 768 });
    const week = await page.locator('#weekNavLabel').textContent();
    const tue = page.locator('.day-row[data-date="2026-07-14"]');
    await tue.locator('label.col-day').click();
    await tue.locator('.pill-annual_leave').click();
    await expect(page.locator('#stagedBar')).toBeVisible();
    // Escape answers the question the way "Keep editing" does: nothing moves, nothing is discarded.
    await page.locator('#prevWeekBtn').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#unsavedBanner')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#unsavedBanner')).toBeHidden();
    await expect(page.locator('#weekNavLabel'), 'the week did not change').toHaveText(/** @type {string} */ (week));
    await expect(tue, 'the staged AL is still staged').toHaveAttribute('data-type', 'annual_leave');
    await expect(page.locator('#prevWeekBtn'), 'focus is back where the reader was').toBeFocused();
    // The bar is drawn at the foot of the screen, and it comes AFTER the page in the tab order: before
    // <main>, its two buttons were the first Tab stops whenever anything was staged.
    await page.locator('#navMenuBtn').focus();
    await page.keyboard.press('Shift+Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('#stagedBar')),
        'nothing before the burger — the Unsaved bar is not ahead of the page').toBe(false);
    expect(await page.evaluate(() => !!(document.querySelector('main')?.compareDocumentPosition(
        /** @type {HTMLElement} */ (document.getElementById('stagedBar'))) & Node.DOCUMENT_POSITION_FOLLOWING)),
        'the bar follows <main> in the document').toBe(true);
});

// THE QUESTION GETS THE FOCUS (shared-ui-4). A week picked in the jump with work staged raises the
// unsaved-changes question, which focuses "Keep editing" — from inside the picker's `change`, while
// the picker was still open, so its focus guard pulled focus back into the closing picker.
test('admin: a week picked from the keyboard with work staged puts focus on the unsaved-changes question', async ({ page }, info) => {
    test.skip(isTouchProject(info), 'a keyboard');
    await deskAdmin(page, { width: 1366, height: 768 });
    const tue = page.locator('.day-row[data-date="2026-07-14"]');
    await tue.locator('label.col-day').click();
    await tue.locator('.pill-annual_leave').click();
    await expect(page.locator('#stagedBar')).toBeVisible();
    await page.locator('#weekNavLabel').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#dpGrid .dp-day:focus'), 'the picker opens on the chosen day').toHaveCount(1);
    await page.keyboard.press('ArrowDown');   // a week on
    await page.keyboard.press('Enter');
    await expect(page.locator('#datePickerLightbox')).toBeHidden();
    await expect(page.locator('#unsavedBanner')).toBeVisible();
    await expect(page.locator('#unsavedKeepBtn'), 'the member lands on the question, not where the picker opened').toBeFocused();
});

test('admin: on a desktop the staff member picker is two Tab presses from the burger, as on a phone — and still sits atop the right column', async ({ page }, info) => {
    // From 1024px the bar used to be MOVED into the right column, which put the page's one member
    // control behind the whole Change a Shift card: 23 Tab presses, against 2 on a phone. It now keeps
    // its place in the document and is only DRAWN in the right column — the same place as before, and
    // the side column stuck the same 16px beneath it while the page scrolls.
    test.skip(isTouchProject(info), 'the two-column layout and a keyboard');
    await deskAdmin(page, { width: 1366, height: 768 });
    await page.locator('#navMenuBtn').focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(page.locator('#fieldMemberTrigger'), 'burger → logo → the member picker').toBeFocused();
    const geo = () => page.evaluate(() => {
        const bar = /** @type {HTMLElement} */ (document.querySelector('.member-context-bar')).getBoundingClientRect();
        const side = /** @type {HTMLElement} */ (document.querySelector('.col-side')).getBoundingClientRect();
        const main = /** @type {HTMLElement} */ (document.querySelector('.col-main')).getBoundingClientRect();
        return { sameColumn: Math.abs(bar.left - side.left) < 1 && Math.abs(bar.width - side.width) < 1,
                 rightOfMain: bar.left > main.right, gap: Math.round(side.top - bar.bottom), top: Math.round(bar.top) };
    });
    const atRest = await geo();
    expect(atRest.sameColumn && atRest.rightOfMain, 'the bar is drawn atop the right column').toBe(true);
    expect(atRest.gap, 'with the side column 16px beneath it').toBe(16);
    await page.evaluate(() => window.scrollTo(0, 300));
    await expect.poll(geo, { message: 'scrolled, the two stay pinned together: the bar at the top, the column under it' })
        .toEqual({ sameColumn: true, rightOfMain: true, gap: 16, top: 20 });
});

// THE STAFF PICKER SHOWS KEYBOARD FOCUS ON THE NAVY BAR (Nov 2026). Below 1024px the member bar is navy,
// and the picker took a field's default ring — navy, drawn 2px out on the navy bar, 1:1 — so only its
// border turning gold said where focus was. It wears the gold ring the navy Unsaved bar's buttons wear;
// from 1024px the bar is a white card and keeps the navy one. Measured from the PAINTED colours: what
// counts is the ring against what is actually behind it, which no token comparison can see.
test('admin: the staff picker\'s focus ring stands out from the member bar behind it — navy on a phone, white at a desk', async ({ page }, info) => {
    const sizes = isTouchProject(info) ? [{ width: 393, height: 851 }] : [{ width: 900, height: 800 }, { width: 1366, height: 768 }];
    await deskAdmin(page, sizes[0]);
    for (const size of sizes) {
        await page.setViewportSize(size);
        await page.locator('#navMenuBtn').focus();
        await page.keyboard.press('Tab');
        await page.keyboard.press('Tab');
        const picker = page.locator('#fieldMemberTrigger');
        await expect(picker, `${size.width}: burger → logo → the member picker`).toBeFocused();
        const m = await picker.evaluate(el => {
            // Any CSS colour as painted, over what is under it: a canvas resolves oklch, color-mix and alpha
            // (the recipe of calendar.spec.js → installColourProbe, which one spec cannot import from another).
            const ctx = /** @type {CanvasRenderingContext2D} */ (document.createElement('canvas').getContext('2d', { willReadFrequently: true }));
            const paint = (/** @type {string[]} */ ...layers) => { ctx.clearRect(0, 0, 1, 1);
                layers.forEach(c => { ctx.fillStyle = c; ctx.fillRect(0, 0, 1, 1); }); return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3); };
            const lum = (/** @type {number[]} */ c) => c.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; })
                .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
            let host = el.parentElement;   // the surface the ring is drawn on: the nearest painted ancestor
            while (host && getComputedStyle(host).backgroundColor === 'rgba(0, 0, 0, 0)') host = host.parentElement;
            const behind = getComputedStyle(/** @type {Element} */ (host)).backgroundColor, cs = getComputedStyle(el);
            const [hi, lo] = [lum(paint(behind, cs.outlineColor)), lum(paint(behind))].sort((a, b) => b - a);
            const reach = parseFloat(cs.outlineOffset) + parseFloat(cs.outlineWidth), r = el.getBoundingClientRect(), b = /** @type {Element} */ (host).getBoundingClientRect();
            return { focusVisible: el.matches(':focus-visible'), style: cs.outlineStyle, width: parseFloat(cs.outlineWidth),
                     ratio: Math.round((hi + 0.05) / (lo + 0.05) * 100) / 100, onBar: /** @type {Element} */ (host).classList.contains('member-context-bar'),
                     ringInsideBar: r.left - reach >= b.left && r.right + reach <= b.right && r.top - reach >= b.top && r.bottom + reach <= b.bottom };
        });
        expect(m.focusVisible, `${size.width}: a keyboard focus`).toBe(true);
        expect(m.onBar, `${size.width}: premise: the ring is drawn on the member bar`).toBe(true);
        expect(m.style, `${size.width}: a ring is drawn`).not.toBe('none');
        expect(m.width, `${size.width}: at least 2px`).toBeGreaterThanOrEqual(2);
        expect(m.ratio, `${size.width}: 3:1 against the bar behind it`).toBeGreaterThanOrEqual(3);
        expect(m.ringInsideBar, `${size.width}: and the bar has room for all of it`).toBe(true);
    }
});

// ONE BAR, ONE LABEL COLOUR (whole-app fix, 10 Nov 2026). Overtime's copy of this bar ("a member arriving from admin
// sees the same first line", overtime.css) took its label from the on-navy token; Admin's kept a white-alpha literal,
// so the two bars that should match did not (7.6:1 against 8.7:1). Read off the navy bar a phone draws.
test('admin: the member bar\'s label is the app\'s on-navy secondary text, as on Overtime\'s copy of the bar', async ({ page }) => {
    await deskAdmin(page, { width: 390, height: 844 });
    const label = page.locator('.member-context-bar label').first();
    await expect(label).toBeVisible();
    expect(await label.evaluate(el => getComputedStyle(/** @type {Element} */ (el.closest('.member-context-bar'))).backgroundColor),
        'premise: at a phone width the bar is navy').toBe(await tokenColour(page, '--primary-blue'));
    expect(await label.evaluate(el => getComputedStyle(el).color)).toBe(await tokenColour(page, '--on-navy-muted'));
});

test('admin: each calendar is ONE Tab stop, and the arrow keys move the day — the leave range and the week jump', async ({ page }, info) => {
    // Every day was its own Tab stop: ~62 to cross the two open range calendars, and the arrows did
    // nothing in either picker. Now a roving tabindex, as the Calendar's own grid.
    test.skip(isTouchProject(info), 'a keyboard');
    await deskAdmin(page, { width: 1366, height: 900 });
    await page.locator('#alToggleHeader').click();
    const grid = page.locator('#alRpGrid');
    const stops = grid.locator('.rp-day[tabindex="0"]');
    await expect(stops, 'one stop in the whole month').toHaveCount(1);
    await expect(stops, 'and it is today, with nothing chosen yet').toHaveAttribute('data-iso', '2026-07-15');
    await stops.focus();
    const at = () => page.evaluate(() => /** @type {HTMLElement|null} */ (document.activeElement)?.dataset.iso ?? null);
    await page.keyboard.press('ArrowRight');
    expect(await at()).toBe('2026-07-16');
    await page.keyboard.press('ArrowDown');
    expect(await at()).toBe('2026-07-23');
    await page.keyboard.press('End');
    expect(await at(), 'End is the week row\'s Saturday').toBe('2026-07-25');
    await page.keyboard.press('PageDown');
    expect(await at(), 'Page Down turns the month').toBe('2026-08-25');
    await expect(page.locator('#alRpLabel')).toHaveText('August 2026');
    await expect(stops, 'the stop moved with the keyboard, and is still the only one').toHaveCount(1);
    await expect(stops).toHaveAttribute('data-iso', '2026-08-25');
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('#alRpGrid')), 'one Tab leaves the month').toBe(false);

    // The week jump: the app's own date picker, opened from the keyboard.
    await page.locator('#weekNavLabel').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.dp-content')).toBeVisible();
    await expect(page.locator('#dpGrid .dp-day:not([tabindex="-1"])'), 'one stop in the picker\'s month').toHaveCount(1);
    // The picker takes focus in the frame AFTER it opens (createLightbox, overlay.js), so this waits for
    // it: read once, on a busy machine it was still on the week label (13 Nov 2026).
    await expect.poll(at, { message: 'it opens on the chosen day' }).toBe('2026-07-15');
    await page.keyboard.press('ArrowRight');
    expect(await at()).toBe('2026-07-16');
    await page.keyboard.press('ArrowUp');
    expect(await at()).toBe('2026-07-09');
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('#dpGrid')), 'one Tab leaves the picker\'s month').toBe(false);
    // …for the picker's own ✕, not the page behind it (shared-ui-1). The trap took the month's last
    // day — `tabindex="-1"`, a stop Tab can never land on — as its last stop, so Tab from the day the
    // keyboard was on was not wrapped and walked out of the dialog.
    await expect(page.locator('.dp-close'), 'Tab wraps inside the dialog').toBeFocused();
    await page.keyboard.press('Shift+Tab');
    expect(await at(), 'and Shift+Tab from the ✕ comes back round to the day').toBe('2026-07-09');
});

test('admin: with a mouse, the bulk bar\'s type pills are the same capsules as a row\'s', async ({ page }, info) => {
    // They kept the base 44px height for a fine pointer — AL a 36×44 lozenge, taller than wide — beside
    // the 46×34 capsules on every row. A touch screen keeps its own, larger, sizes.
    test.skip(isTouchProject(info), 'a fine pointer');
    await deskAdmin(page, { width: 1366, height: 900 });
    await page.locator('.day-row[data-date="2026-07-14"] label.col-day').click();
    const size = (/** @type {string} */ sel) => page.locator(sel).evaluate(el => {
        const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) };
    });
    const bulk = await size('#bulkTypePills .pill-annual_leave');
    const row = await size('.day-row[data-date="2026-07-14"] .pill-annual_leave');
    expect(bulk.h, 'the bulk pill is the row pill\'s height').toBe(row.h);
    expect(bulk.w, 'and wider than it is tall').toBeGreaterThan(bulk.h);
});

test('admin: hovering a chosen type pill leaves it as it is; an idle one takes a tint of its colour, never a fade', async ({ page }, info) => {
    // `opacity: 0.75` on every pill under the pointer faded a CHOSEN AL's white-on-teal from 5.19:1 to
    // 3.31:1 — a hover repainting a choice, and a fade on words still being read.
    test.skip(isTouchProject(info), 'a mouse');
    await deskAdmin(page, { width: 1366, height: 900 });
    const tue = page.locator('.day-row[data-date="2026-07-14"]');
    await tue.locator('label.col-day').click();
    const chosen = tue.locator('.pill-annual_leave');
    await chosen.click();
    await expect(chosen).toHaveClass(/\bactive\b/);
    // Read once the pill's transition has run: "did not change" passes trivially on a read taken
    // before the hover's own transition has begun.
    const paint = async (/** @type {import('@playwright/test').Locator} */ loc) => (await settled(loc))
        .evaluate(el => ({ op: getComputedStyle(el).opacity, bg: getComputedStyle(el).backgroundColor }));
    await page.mouse.move(2, 2);
    expect(await paint(chosen), 'premise: the chosen pill at rest is AL\'s own fill')
        .toEqual({ op: '1', bg: await tokenColour(page, '--al') });
    await chosen.hover();
    expect(await paint(chosen), 'the chosen pill does not change under the pointer')
        .toEqual({ op: '1', bg: await tokenColour(page, '--al') });
    const idle = tue.locator('.pill-rdw');
    await idle.hover();
    const hovered = await paint(idle);
    expect(hovered.op, 'an idle pill is never faded').toBe('1');
    expect(hovered.bg, 'it takes a tint instead').not.toBe('rgba(0, 0, 0, 0)');
});

test('admin: ticking or typing a row never moves it, a row ready to save is not Today\'s colour, and Tips describes what is drawn', async ({ page }, info) => {
    // Ticking widened the left border 1px → 4px and shoved the row's content 3px right; a row with a
    // type wore `--today-print`, Today's own tint, with no bar; and Tips said the row "turns gold".
    test.skip(isTouchProject(info), 'the desk layout and a mouse');
    await deskAdmin(page, { width: 1366, height: 900 });
    const row = (/** @type {string} */ iso) => page.locator(`.day-row[data-date="${iso}"]`);
    // Each read waits for the row's transitions (its tint and bar ease in), or two states compare
    // as different only because one was caught halfway.
    const look = async (/** @type {string} */ iso) => (await settled(row(iso))).evaluate(el => ({
        cb: Math.round(/** @type {HTMLElement} */ (el.querySelector('.day-cb')).getBoundingClientRect().left * 10) / 10,
        bg: getComputedStyle(el).backgroundColor, bar: getComputedStyle(el).boxShadow,
    }));
    const untouched = await look('2026-07-13');
    await row('2026-07-13').locator('.day-cb').check();
    const ticked = await look('2026-07-13');
    await row('2026-07-13').locator('.pill-annual_leave').click();
    await page.mouse.move(2, 2);
    const ready = await look('2026-07-13');
    expect(ticked.cb, 'ticking does not move the row').toBe(untouched.cb);
    expect(ready.cb, 'nor does giving it a type').toBe(untouched.cb);
    const today = await look('2026-07-15');
    expect(ready.bg, 'a row ready to save is not Today\'s tint').not.toBe(today.bg);
    expect(ready.bg, 'nor the ticked row\'s').not.toBe(ticked.bg);
    expect(ticked.bar, 'a ticked row has its bar').toMatch(/inset/);
    expect(ready.bar, 'so does a row ready to save').toMatch(/inset/);
    expect(ready.bar, 'the bar is drawn').not.toMatch(/^rgba\(0, 0, 0, 0\)|^none/);
    // A mouse is told the rest of the row is a target too — on an untouched row only.
    const sat = row('2026-07-18');
    const restBg = (await look('2026-07-18')).bg;
    await sat.hover({ position: { x: 300, y: 10 } });
    expect((await look('2026-07-18')).bg, 'an untouched row tints under the pointer').not.toBe(restBg);
    // Tips: the words match the pixels.
    await page.locator('.btn-card-tips[data-card="change-shift"]').click();
    const tips = page.locator('#tipsLbBody');
    await expect(tips).toContainText('with a gold edge, to show it is ready to save');
    await expect(tips).toContainText('A ticked day with no type yet has the gold edge only');
    await expect(tips, 'the arrows, for a mouse — not swipe alone').toContainText('Move between weeks with ‹ and ›');
});

test('admin: the small things on a desk — Today\'s word, the Saved Changes times, and no "tap" in the save hint', async ({ page }, info) => {
    test.skip(isTouchProject(info), 'the desk layout');
    await deskAdmin(page, { width: 1366, height: 900 }, [
        { id: 'c1', memberName: 'G. Miller', date: '2026-07-17', value: '06:00-14:00', type: 'shift', source: 'manual' },
    ]);
    // "Today" was 10px — the smallest word on the page, inside an 84×44 gold button.
    expect(parseFloat(await page.locator('.week-today-word').evaluate(el => getComputedStyle(el).fontSize)),
        'the Today word is a readable size').toBeGreaterThanOrEqual(12);
    // The save hint names no touch verb on a desk.
    await expect(page.locator('#saveBtnHint')).not.toContainText(/\btap\b/i);
    // Saved Changes' times were a system monospace — Consolas on the station PC.
    await page.locator('#overridesToggleHeader').click();
    const value = page.locator('.override-card .oc-value').first();
    await expect(value).toContainText('06:00');
    const fonts = await value.evaluate(el => ({ own: getComputedStyle(el).fontFamily, page: getComputedStyle(document.body).fontFamily, nums: getComputedStyle(el).fontVariantNumeric }));
    expect(fonts.own, 'the times are in the page\'s typeface').toBe(fonts.page);
    expect(fonts.nums, 'with tabular figures, so they line up').toBe('tabular-nums');
});
