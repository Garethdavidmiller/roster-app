/**
 * paycalc-layout.spec.js — the Pay Calculator (paycalc.html): how the page is drawn — focus rings,
 * buttons, motion and print, and the desktop audit (PAY1–PAY12).
 *
 * Split by feature out of paycalc.spec.js on 25 Nov 2026, test for test and unchanged; what more than
 * one paycalc-*.spec.js file needs is in paycalc-helpers.js, including the roster rows these tests sign
 * in as, which are chosen by shape and never written down (payroll-anonymity.test.mjs).
 */
import { test, expect } from './fixtures.js';
import { seedSession, seedMember, isTouchProject, scaleText } from './helpers.js';
import { PT_QUIET, LUMP_QUIET, AUDIT_DAY, payPageReady, openReturning } from './paycalc-helpers.js';

// ── THE STYLESHEET, READ LINE BY LINE (whole-app check, 10 Nov 2026) ─────────────────────────────
// paycalc.css findings that only a rendered page shows: each test measures what a member sees.

/** A CSS colour expression as this page computes it, for comparing with a computed colour.
 *  @param {import('@playwright/test').Page} page @param {string} value */
const pcColour = (page, value) => page.evaluate((v) => {
    const i = document.createElement('i'); i.style.color = v; document.body.append(i);
    const c = getComputedStyle(i).color; i.remove(); return c;
}, value);

test('paycalc: a Tab stop wears the ring drawn for the surface it is on', async ({ page }, info) => {
    // The help sheet's ✕ and the guide link at the foot of the page had no focus rule of their own,
    // so they took the app's navy fallback ring: 1.17:1 on the dark glass and 1:1 on the navy canvas.
    // The ? panels are the shared WHITE Tips sheet since Nov 2026, so their ✕ takes the navy ring every
    // other page's Tips ✕ wears — gold there would be ~1.5:1.
    test.skip(isTouchProject(info), 'a keyboard');
    await seedSession(page);
    await page.addInitScript(() => localStorage.setItem('myb_pc_ns_migrated', '1'));
    await page.goto('/paycalc.html');
    await expect(page.locator('#netDisplay')).toHaveText(/£\d/);
    const gold = await pcColour(page, 'var(--accent-gold)');
    const ring = (/** @type {import('@playwright/test').Locator} */ el) => el.evaluate(e => {
        const cs = getComputedStyle(e);
        return { focus: e.matches(':focus-visible'), style: cs.outlineStyle, colour: cs.outlineColor };
    });

    const link = page.locator('.guide-footer-link a');
    await link.focus();
    expect(await ring(link), 'the guide link on the navy canvas').toEqual({ focus: true, style: 'solid', colour: gold });

    await page.locator('.help-btn[data-help="hours"]').click();
    await expect(page.locator('#tipsLightbox.visible')).toBeVisible();
    const close = page.locator('#tipsLightboxClose');
    for (let i = 0; i < 6 && !(await close.evaluate(e => e === document.activeElement)); i++) await page.keyboard.press('Tab');
    expect(await ring(close), 'the ? panel\'s ✕ on the white sheet').toEqual({ focus: true, style: 'solid', colour: await pcColour(page, 'var(--primary-blue)') });
});

test('paycalc: the Training Days stepper draws its focus ring whole', async ({ page }, info) => {
    // The stepper clips (`overflow: hidden`) and its buttons sit flush against three of its edges, so
    // a ring drawn 2px OUTSIDE a button lost those three sides: one navy bar beside the number.
    test.skip(isTouchProject(info), 'a keyboard');
    await seedSession(page);
    await page.addInitScript(() => localStorage.setItem('myb_pc_ns_migrated', '1'));
    await page.goto('/paycalc.html');
    await expect(page.locator('#netDisplay')).toHaveText(/£\d/);
    for (const id of ['peerMinus', 'peerPlus']) {
        const button = page.locator(`#${id}`);
        await button.focus();
        const g = await button.evaluate(b => {
            const cs = getComputedStyle(b), box = b.getBoundingClientRect();
            const st = /** @type {HTMLElement} */ (b.closest('.stepper'));
            const sr = st.getBoundingClientRect(), edge = parseFloat(getComputedStyle(st).borderTopWidth);
            const out = parseFloat(cs.outlineWidth) + parseFloat(cs.outlineOffset);   // how far the ring reaches past the button
            return { focus: b.matches(':focus-visible'), style: cs.outlineStyle,
                clipped: [box.left - out < sr.left + edge - 0.5, box.right + out > sr.right - edge + 0.5,
                          box.top - out < sr.top + edge - 0.5, box.bottom + out > sr.bottom - edge + 0.5] };
        });
        expect(g.focus && g.style === 'solid', `#${id} shows a ring`).toBe(true);
        expect(g.clipped, `#${id}'s ring runs past the stepper's clip on [left, right, top, bottom]`).toEqual([false, false, false, false]);
    }
});

test('paycalc: a disclosure arrow points down when shut and up when open', async ({ page }) => {
    // The script swaps these two arrows' glyph (▼ → ▲) AND the stylesheet turned an open one by 180°,
    // so after a quarter-second spin the ▲ faced down again: shut and open looked the same. What is
    // asserted is the way the arrow FACES — glyph and rotation together — not either one alone.
    await seedSession(page);
    await page.addInitScript(() => localStorage.setItem('myb_pc_ns_migrated', '1'));
    await page.goto('/paycalc.html');
    await expect(page.locator('#netDisplay')).toHaveText(/£\d/);
    const facing = (/** @type {string} */ sel) => page.locator(sel).evaluate(el => Promise.all(el.getAnimations().map(a => a.finished)).then(() => {
        const t = getComputedStyle(el).transform;
        const turned = t !== 'none' && new DOMMatrixReadOnly(t).a < 0;   // a half turn
        return (el.textContent?.trim() === '▲') !== turned ? 'up' : 'down';
    }));
    if (!await page.locator('#hppCardBody').evaluate(el => el.classList.contains('open'))) {
        await page.locator('#hppCardToggle .card-toggle-arrow').click();
    }
    for (const [button, arrow] of [['#hoursShowMore', '.show-more-arrow'], ['#hppToggleBtn', '.hpp-toggle-arrow']]) {
        const btn = page.locator(button);
        await btn.scrollIntoViewIfNeeded();
        expect(await facing(`${button} ${arrow}`), `${button} shut`).toBe('down');
        await btn.click();
        await expect(btn).toHaveAttribute('aria-expanded', 'true');
        expect(await facing(`${button} ${arrow}`), `${button} open`).toBe('up');
        await btn.click();
        await expect(btn).toHaveAttribute('aria-expanded', 'false');
        expect(await facing(`${button} ${arrow}`), `${button} shut again`).toBe('down');
    }
});

test('paycalc: a back-pay rate locked from the record reads as a fixed value, and does not glow on focus', async ({ page }, info) => {
    // A CES member on a 2025/26 payslip: that award's OLD rate is not on record, so three of the four
    // boxes are locked and one stays editable (paycalc-backpay.js). The locked rule was (0,1,1) inside
    // `.field`, whose own input rule is (0,3,1), so all but the cursor lost: three boxes that looked
    // editable, padlock and all, and brightened with the 4px glow when Tab reached them.
    test.skip(isTouchProject(info), 'a keyboard');
    await page.clock.setFixedTime(new Date('2026-10-22T09:00:00Z'));
    await seedSession(page, 'F. Mohamed');
    await page.addInitScript(() => localStorage.setItem('myb_pc_ns_migrated', '1'));
    await page.goto('/paycalc.html?payday=2025-11-21');
    await expect(page.locator('#netDisplay')).toHaveText(/£\d/);
    if (!await page.locator('#backPayBody').evaluate(el => el.classList.contains('open'))) {
        await page.locator('#backPayCardToggle .card-toggle-arrow').click();
    }
    await expect(page.locator('#backPayBody')).toHaveCSS('visibility', 'visible');
    if (await page.locator('#bpModeCompute').isVisible()) await page.locator('#bpModeCompute').check();
    await expect(page.locator('#newRateInput')).toHaveClass(/bp-rate-locked/);
    await expect(page.locator('#oldRate'), 'the premise: a figure not on record stays editable').not.toHaveClass(/bp-rate-locked/);
    const look = (/** @type {string} */ id) => page.locator(`#${id}`).evaluate(el => Promise.all(el.getAnimations().map(a => a.finished)).then(() => {
        const cs = getComputedStyle(el);
        return { fill: cs.backgroundColor, edge: cs.borderTopColor, weight: cs.fontWeight, room: cs.paddingRight, glow: cs.boxShadow };
    }));
    const fixedValue = { ...(await look('hourlyRate')), glow: 'none' };   // the read-only Settings rate
    for (const id of ['newRateInput', 'oldLondon', 'newLondon']) expect(await look(id), `#${id} at rest`).toEqual(fixedValue);
    expect((await look('oldRate')).fill, 'the editable box keeps the field fill').not.toBe(fixedValue.fill);

    await page.locator('#oldRate').focus();
    await page.keyboard.press('Tab');
    await expect(page.locator('#newRateInput')).toBeFocused();
    expect(await look('newRateInput'), 'focused by keyboard: no glow, no brightening').toEqual(fixedValue);
    expect(await page.locator('#newRateInput').evaluate(el => getComputedStyle(el).outlineStyle), 'and the ring still shows where you are').toBe('solid');
});

test('paycalc desktop: a hidden setup banner or privacy note leaves no gap behind it', async ({ page }, info) => {
    // The setup banner and the first-visit privacy note once owned grid rows 1 and 2, and an empty
    // grid row still takes its row-gap: a RETURNING member — both hidden, the normal state — had the
    // workspace 20px under the header against the 4px of every other card page (pages.spec.js
    // measures the first visit only, where both show). And with the banner up, the take-home column
    // started BELOW those rows, a navy void at the top right (laptop polish, 13 Nov 2026). Both notes
    // now head the work column itself, so this measures both halves: one 16px gap between whatever
    // shows, and the take-home level with the first of it.
    test.skip(isTouchProject(info), 'the 1366px desktop grid');
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.clock.setFixedTime(new Date('2026-10-22T09:00:00Z'));
    // [name, seed, which of banner / note the state shows] — all four combinations.
    const states = /** @type {const} */ ([
        ['first visit', {}, [true, true]],
        // A payslip saved, the year's settings never confirmed. (A bare `…_setup` is no good here: a
        // migration turns it into per-year confirmations, which hide the banner too.)
        ['settings not yet confirmed', { myb_pc_gmiller_p57: JSON.stringify({ satH: 8 }) }, [true, false]],
        ['no pay data yet', { myb_pc_gmiller_setup_2026_27: '1' }, [false, true]],
        ['returning member', { myb_pc_gmiller_setup: '1', myb_pc_gmiller_setup_2026_27: '1' }, [false, false]],
    ]);
    await seedSession(page);
    await page.addInitScript(() => localStorage.setItem('myb_pc_ns_migrated', '1'));
    await page.goto('/paycalc.html');
    for (const [name, seed, shows] of states) {
        // This member's pay keys cleared, then exactly the state's — and the page loaded on them.
        await page.evaluate(s => {
            Object.keys(localStorage).filter(k => k.startsWith('myb_pc_gmiller_')).forEach(k => localStorage.removeItem(k));
            for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
        }, seed);
        await page.reload();
        await expect(page.locator('#netDisplay')).toHaveText(/£\d/);
        expect([await page.locator('#setupBanner').isVisible(), await page.locator('#privacyNoteTop').isVisible()],
            `${name}: the premise — which of the banner and the note it shows`).toEqual(shows);
        const m = await page.evaluate(() => {
            const header = /** @type {Element} */ (document.querySelector('.app-header')).getBoundingClientRect().bottom;
            const shown = ['#setupBanner', '#privacyNoteTop', '.period-controls']
                .map(s => /** @type {HTMLElement} */ (document.querySelector(s)))
                .filter(el => el.getClientRects().length)
                .map(el => el.getBoundingClientRect());
            const result = /** @type {Element} */ (document.querySelector('.result-card')).getBoundingClientRect();
            return { top: Math.round(shown[0].top - header),
                     steps: shown.slice(1).map((r, i) => Math.round(r.top - shown[i].bottom)),
                     resultOffset: Math.round(result.top - shown[0].top) };
        });
        expect(m.top, `${name}: the first block sits 4px under the header`).toBe(4);
        expect(m.steps.every(s => s === 16), `${name}: one 16px gap between the blocks, measured ${JSON.stringify(m.steps)}`).toBe(true);
        expect(m.resultOffset, `${name}: the take-home heads column 3, level with the first block — no navy above it`).toBe(0);
    }
});

test('paycalc: at large text an open card is never cut short — Save settings stays reachable', async ({ page }, info) => {
    // The open cards were capped at fixed pixel heights (1800px, the HPP note 400px) under
    // `overflow: hidden`, sized against DEFAULT text. At Android's 1.3x a Settings card with a student
    // loan and a pension opt-out measured 1916px at 360px wide, so its last 116px — Save settings —
    // was clipped with no way to scroll to it. A card's height grows faster than its text (more
    // lines AND taller ones), so the caps are in `em` now.
    test.skip(!isTouchProject(info), 'a phone with its text scaled');
    await page.setViewportSize({ width: 360, height: 800 });
    await page.clock.setFixedTime(new Date('2026-10-22T09:00:00Z'));
    await seedSession(page);
    await page.addInitScript(() => localStorage.setItem('myb_pc_ns_migrated', '1'));
    await page.goto('/paycalc.html');
    await expect(page.locator('#netDisplay')).toHaveText(/£\d/);
    if (!await page.locator('#settingsBody').evaluate(el => el.classList.contains('open'))) {
        await page.locator('#settingsToggle .card-toggle-arrow').click();
    }
    await expect(page.locator('#settingsBody')).toHaveCSS('visibility', 'visible');
    await page.evaluate(() => {   // the tallest ordinary Settings: a loan plan and the opt-out's dated question
        const s = /** @type {HTMLSelectElement} */ (document.getElementById('studentLoan'));
        s.value = 'plan2'; s.dispatchEvent(new Event('change', { bubbles: true }));
        const c = /** @type {HTMLInputElement} */ (document.getElementById('pensionOptOutCheck'));
        if (!c.checked) c.click();
    });
    await expect(page.locator('#pensionOptOutField')).toBeVisible();
    if (!await page.locator('#hppCardBody').evaluate(el => el.classList.contains('open'))) {
        await page.locator('#hppCardToggle .card-toggle-arrow').click();
    }
    await page.locator('#hppToggleBtn').click();
    // Android's text scaling: every element's OWN size × 1.6, read first and written after, so an
    // inherited size is scaled once.
    const scale = () => scaleText(page, 1.6);
    await scale();
    const clip = (/** @type {string} */ sel) => page.locator(sel).evaluate(el =>
        Promise.all(document.getAnimations().map(a => a.finished.catch(() => {}))).then(() => el.scrollHeight - el.clientHeight));
    expect(await clip('#settingsBody'), 'Settings content hidden below its cap').toBeLessThanOrEqual(1);
    expect(await clip('#hppNoteBody'), '"How is this calculated?" hidden below its cap').toBeLessThanOrEqual(1);
    const inside = await page.evaluate(() => {
        const save = /** @type {Element} */ (document.getElementById('saveSettingsBtn')).getBoundingClientRect();
        const body = /** @type {Element} */ (document.getElementById('settingsBody')).getBoundingClientRect();
        return save.bottom <= body.bottom + 0.5;
    });
    expect(inside, 'Save settings sits inside its open card').toBe(true);

    // The Boxing Day banner (a 60px cap) wraps to a second line at this size: 88px of it.
    await page.clock.setFixedTime(new Date('2026-12-20T09:00:00Z'));
    await page.goto('/paycalc.html?payday=2027-01-08');
    await expect(page.locator('.boxing-banner.visible')).toBeVisible();
    await scale();
    expect(await clip('.boxing-banner'), 'the Boxing Day banner hidden below its cap').toBeLessThanOrEqual(1);
});

test('paycalc: a notice sheet\'s two answers are one width, from tablet up', async ({ page }, info) => {
    // From 768px every `.btn-primary` stopped at 280px — a cap written for the cards, whose two
    // buttons were then exempted by name. What it still reached was the first answer in each notice
    // sheet: "Yes, it's mine" 280px wide over a 290px "No — start fresh" (its label then), the mismatched pair the
    // cap's own comment called a fault.
    test.skip(isTouchProject(info), 'tablet and desktop widths');
    await page.clock.setFixedTime(new Date('2026-11-10T09:00:00Z'));
    await seedSession(page);   // G. Miller, whose device also offers the developer's actuals sheet
    await page.addInitScript(() => {
        localStorage.setItem('myb_pc_rate', '20.74');   // unclaimed legacy pay data: the ownership question
        localStorage.removeItem('myb_pc_ns_migrated');
    });
    const settle = () => page.evaluate(() => Promise.all(document.getAnimations().map(a => a.finished.catch(() => {}))));
    const boxes = (/** @type {string[]} */ ids) => page.evaluate(list => list.map(id => {
        const r = /** @type {Element} */ (document.getElementById(id)).getBoundingClientRect();
        return { left: Math.round(r.left), width: Math.round(r.width) };
    }), ids);
    for (const width of [800, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto('/paycalc.html');
        await expect(page.locator('#dataOwnerLightbox.visible')).toBeVisible();
        await settle();
        const [mine, fresh] = await boxes(['dataOwnerMine', 'dataOwnerFresh']);
        expect(mine, `${width}px: "Yes, it's mine" against "No — delete it" under it`).toEqual(fresh);

        await page.locator('#dataOwnerClose').click();   // decide later
        await expect(page.locator('#dataOwnerLightbox')).not.toHaveClass(/visible/);
        if (!await page.locator('#settingsBody').evaluate(el => el.classList.contains('open'))) {
            await page.locator('#settingsToggle .card-toggle-arrow').click();
        }
        await page.locator('#actualsImportBtn').click();
        await expect(page.locator('#actualsLightbox.visible')).toBeVisible();
        await settle();
        const [load, clear] = await boxes(['actualsImport', 'actualsClear']);
        expect(load, `${width}px: "Import" against "Clear stored data" under it`).toEqual(clear);
    }
});

test('paycalc: a primary button and the secondary under it are drawn by one recipe', async ({ page }) => {
    // paycalc.css kept its own `.btn-primary` recipe for Save settings, then the one primary without
    // `.btn-action` — and it reached the three that do, overriding the shared recipe's display, edge
    // and timing: two shapes in one pair. Nothing differed by a pixel, which is why it is the computed
    // SHAPE that is compared — the next change to the shared recipe would have split them. Save
    // settings wears `.btn-action` too now (Nov 2026), and the page recipe has gone.
    await page.clock.setFixedTime(new Date('2026-11-10T09:00:00Z'));
    await seedSession(page);
    await page.addInitScript(() => {
        localStorage.setItem('myb_pc_rate', '20.74');   // the ownership question
        localStorage.removeItem('myb_pc_ns_migrated');
    });
    const shape = (/** @type {string[]} */ ids) => page.evaluate(list => list.map(id => {
        const cs = getComputedStyle(/** @type {Element} */ (document.getElementById(id)));
        return [cs.display, cs.borderTopWidth, cs.borderTopStyle, cs.padding, cs.borderTopLeftRadius,
            cs.minHeight, cs.fontSize, cs.fontWeight, cs.transitionProperty, cs.transitionDuration].join(' | ');
    }), ids);
    await page.goto('/paycalc.html');
    await expect(page.locator('#dataOwnerLightbox.visible')).toBeVisible();
    const [mine, fresh] = await shape(['dataOwnerMine', 'dataOwnerFresh']);
    expect(mine, '"Yes, it\'s mine" against "No — delete it"').toBe(fresh);
    await page.locator('#dataOwnerClose').click();
    await expect(page.locator('#dataOwnerLightbox')).not.toHaveClass(/visible/);
    if (!await page.locator('#payTransferBody').evaluate(el => el.classList.contains('open'))) {
        await page.locator('#payTransferToggle .card-toggle-arrow').click();
    }
    await expect(page.locator('#ptDownload')).toBeVisible();
    const [download, copy] = await shape(['ptDownload', 'ptCopy']);
    expect(download, '"Download backup" against "Copy as text"').toBe(copy);
    // …and Save settings is one more primary drawn by it, not by a recipe of its own.
    if (!await page.locator('#settingsBody').evaluate(el => el.classList.contains('open'))) {
        await page.locator('#settingsToggle .card-toggle-arrow').click();
    }
    await expect(page.locator('#saveSettingsBtn')).toBeVisible();
    const [save] = await shape(['saveSettingsBtn']);
    expect(save, '"Save settings" against "Download backup"').toBe(download);
});

// …and it keeps the gap a block button had (whole-app check, 10 Nov 2026). As a `.btn-action` it is an inline-flex
// box, whose margin does not collapse into the field above, so its own 8px top margin was ADDED to the 14px every
// field keeps below it: 22px. Measured at a phone and a desktop width.
test('paycalc: Save settings sits one field gap under the field above it', async ({ page }) => {
    await seedSession(page);
    await page.addInitScript(() => localStorage.setItem('myb_pc_ns_migrated', '1'));
    for (const width of [390, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto('/paycalc.html');
        if (!await page.locator('#settingsBody').evaluate(el => el.classList.contains('open'))) {
            await page.locator('#settingsToggle .card-toggle-arrow').click();
        }
        await expect(page.locator('#saveSettingsBtn')).toBeVisible();
        const m = await page.locator('#saveSettingsBtn').evaluate(btn => {
            let above = btn.previousElementSibling;
            while (above && !above.getClientRects().length) above = above.previousElementSibling;
            const field = /** @type {Element} */ (above);
            return { gap: Math.round(btn.getBoundingClientRect().top - field.getBoundingClientRect().bottom),
                     fieldGap: parseFloat(getComputedStyle(field).marginBottom) };
        });
        expect(m.gap, `at ${width}px, the gap above Save settings against the field's own`).toBe(m.fieldGap);
    }
});

test('paycalc guide: the two bulleted lists keep their bullets on paper', async ({ page }) => {
    // Each bullet is a 5px gold dot drawn as a BACKGROUND (the list is `list-style: none`), and a
    // browser printing with background graphics off — the default — drops backgrounds unless
    // `print-color-adjust: exact` keeps them. "Entering Your Hours" and "Year to Date Figures" printed
    // as indented lines with no markers (seen in a PDF printed that way; page.pdf() cannot show it
    // here, because it is called with backgrounds ON).
    await page.goto('/paycalc-guide.html');
    await expect(page.locator('.guide-disc-list')).toHaveCount(2);
    await page.emulateMedia({ media: 'print' });
    const dots = await page.locator('.guide-disc-list li').evaluateAll(lis => lis.map(li => {
        const cs = getComputedStyle(li, '::before');
        return { shown: cs.display !== 'none' && cs.backgroundColor !== 'rgba(0, 0, 0, 0)',
                 onPaper: cs.getPropertyValue('print-color-adjust') || cs.getPropertyValue('-webkit-print-color-adjust') };
    }));
    await page.emulateMedia({ media: null });
    expect(dots.length, 'the premise: list items to look at').toBeGreaterThan(0);
    for (const [i, dot] of dots.entries()) expect(dot, `bullet ${i + 1}`).toEqual({ shown: true, onPaper: 'exact' });
});

test('paycalc: with reduced motion "How is this calculated?" opens without sliding', async ({ page }) => {
    // Its three sibling reveals (the breakdown, the Boxing Day banner, the cards) are in the page's
    // reduced-motion list; this one was not, and slid open over 0.35s. Both settings are driven, so
    // the slide is seen to exist before its absence is believed.
    await seedSession(page);
    await page.addInitScript(() => localStorage.setItem('myb_pc_ns_migrated', '1'));
    const slides = () => page.locator('#hppNoteBody').evaluate(el => el.getAnimations().filter(a => a.playState === 'running').length);
    for (const motion of /** @type {const} */ (['no-preference', 'reduce'])) {
        await page.emulateMedia({ reducedMotion: motion });
        await page.goto('/paycalc.html');
        await expect(page.locator('#netDisplay')).toHaveText(/£\d/);
        if (!await page.locator('#hppCardBody').evaluate(el => el.classList.contains('open'))) {
            await page.locator('#hppCardToggle .card-toggle-arrow').click();
        }
        await expect(page.locator('#hppCardBody')).toHaveCSS('visibility', 'visible');
        await page.locator('#hppToggleBtn').click();
        await expect(page.locator('#hppNoteBody')).toHaveClass(/open/);
        expect(await slides(), `${motion}: the note's slide`).toBe(motion === 'reduce' ? 0 : 1);
    }
});

test('paycalc: the period buttons share the corner of the period field above them', async ({ page }) => {
    // "← Earlier", "Later →" and 📍 wore --radius-md, the 16px PANEL corner, directly under a 12px
    // field: two corners a few pixels apart in one card, which css-tokens.md → Corners calls
    // "assembled rather than designed". Every action button takes --radius-button.
    await page.clock.setFixedTime(new Date('2026-11-10T09:00:00Z'));
    await seedSession(page);
    await page.addInitScript(() => localStorage.setItem('myb_pc_ns_migrated', '1'));
    await page.goto('/paycalc.html');
    await expect(page.locator('#netDisplay')).toHaveText(/£\d/);
    await page.locator('#prevBtn').click();   // off the current payslip, so 📍 is offered
    await expect(page.locator('#todayPeriodBtn')).toBeVisible();
    const corners = await page.evaluate(() => Object.fromEntries(['periodSelectTrigger', 'periodSelect', 'prevBtn', 'nextBtn', 'todayPeriodBtn']
        .map(id => /** @type {HTMLElement|null} */ (document.getElementById(id)))
        .filter(el => el && el.getClientRects().length)
        .map(el => [/** @type {HTMLElement} */ (el).id, getComputedStyle(/** @type {HTMLElement} */ (el)).borderTopLeftRadius])));
    const field = corners.periodSelectTrigger ?? corners.periodSelect;
    expect(field, 'the premise: the period field is on screen').toBeTruthy();
    for (const id of ['prevBtn', 'nextBtn', 'todayPeriodBtn']) expect(corners[id], `#${id} against the field above it`).toBe(field);
});

test('paycalc: every transition on the page takes its timing from the motion tokens', async ({ page }) => {
    // css-tokens.md → Motion vocabulary: "Use these tokens, not inline cubic-bezier(...) or a bare
    // ease." paycalc.css hand-wrote nine — the same 0.2s four times over, and two content reveals at
    // 0.4s and 0.35s with a bare `ease` beside siblings on --dur-slower. Read from the stylesheet the
    // browser parsed, so a comment cannot count and a rule inside a media query cannot hide.
    await seedSession(page);
    await page.addInitScript(() => localStorage.setItem('myb_pc_ns_migrated', '1'));
    await page.goto('/paycalc.html');
    await expect(page.locator('#netDisplay')).toHaveText(/£\d/);
    const found = await page.evaluate(() => {
        const sheet = [...document.styleSheets].find(s => s.href?.endsWith('/paycalc.css'));
        if (!sheet) return null;
        /** @type {string[]} */ const off = [];
        let read = 0;
        const walk = (/** @type {CSSRuleList} */ rules) => {
            for (const rule of /** @type {any[]} */ ([...rules])) {
                if (rule.cssRules) walk(rule.cssRules);
                if (!rule.style) continue;
                // The shorthand as written; a longhand only where no shorthand set it (a shorthand's
                // `none` reports its longhands' initial `ease`, which nobody wrote).
                const props = rule.style.getPropertyValue('transition') ? ['transition'] : ['transition-duration', 'transition-timing-function'];
                for (const prop of props) {
                    const v = rule.style.getPropertyValue(prop);
                    if (!v) continue;
                    read++;
                    const bare = v.replace(/var\([^)]*\)/g, '').replace(/(^|[\s,])0m?s(?=$|[\s,])/g, '$1');
                    if (/\d(?:\.\d+)?m?s\b/.test(bare) || /(?<![-\w])ease(?![-\w])/.test(bare) || /cubic-bezier\(/.test(bare)) {
                        off.push(`${rule.selectorText} { ${prop}: ${v} }`);
                    }
                }
            }
        };
        walk(sheet.cssRules);
        return { read, off };
    });
    expect(found, 'the premise: paycalc.css is on the page').not.toBeNull();
    expect(found?.read, 'the premise: transitions were read').toBeGreaterThan(10);
    expect(found?.off, 'a timing written out by hand').toEqual([]);
});

test('paycalc: a card header is the shared header — edge, padding and hint as on Settings', async ({ page }) => {
    // paycalc.css kept a copy of the header (padding and divider, the same values) and of the hint,
    // plus a 2px margin no other page has: Pay's hints sat 2px under their titles, every other card
    // page's at 0 (measured on Settings, Operations, Admin, Trains and Links). A page-local copy is
    // what keeps the old look when the shared header changes (css-tokens.md).
    await seedSession(page);
    await seedMember(page);
    await page.addInitScript(() => localStorage.setItem('myb_pc_ns_migrated', '1'));
    const header = () => page.locator('.card-header:has(.hint)').first().evaluate(h => {
        const t = /** @type {Element} */ (h.querySelector('h2')).getBoundingClientRect();
        const hint = /** @type {Element} */ (h.querySelector('.hint'));
        const cs = getComputedStyle(h), hs = getComputedStyle(hint);
        return { padding: cs.padding, divider: `${cs.borderBottomWidth} ${cs.borderBottomStyle} ${cs.borderBottomColor}`,
                 step: Math.round(hint.getBoundingClientRect().top - t.bottom), hint: `${hs.fontSize} ${hs.color}` };
    });
    await page.goto('/settings.html');
    await expect(page.locator('.card-header:has(.hint)').first()).toBeVisible();
    const shared = await header();
    await page.goto('/paycalc.html');
    await expect(page.locator('#netDisplay')).toHaveText(/£\d/);
    expect(await header(), 'the Pay Calculator against Settings').toEqual(shared);
});

test('paycalc: a banner\'s "view … card" link is a thumb-sized target, and takes no tap meant for the tick', async ({ page }, info) => {
    // A real button styled as a link, 12px on a line of its own: ~15px tall, under the app's 24px
    // floor, and the gate never sees it — it loads the page with no banner up. The other small text
    // controls already had an invisible hit area; this one was left out.
    test.skip(!isTouchProject(info), 'a thumb');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.clock.setFixedTime(new Date('2026-08-20T09:00:00Z'));   // the award payslip offers the lump
    await seedSession(page);
    await seedMember(page);
    await page.addInitScript(LUMP_QUIET);
    await page.goto('/paycalc.html');
    await expect(page.locator('#bpActiveBanner')).toBeVisible();
    await page.locator('#bpBannerViewLink').evaluate(el => el.scrollIntoView({ block: 'center' }));
    const m = await page.locator('#bpBannerViewLink').evaluate(el => {
        const r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const reach = (/** @type {number} */ dx, /** @type {number} */ dy) => {
            let n = 0;
            for (let i = 1; i <= 30; i++) {
                const hit = document.elementFromPoint(cx + dx * i, cy + dy * i);
                if (!hit || (hit !== el && !el.contains(hit))) break;
                n = i;
            }
            return n;
        };
        const banner = /** @type {Element} */ (el.parentElement);
        const label = /** @type {Element} */ (banner.querySelector('.banner-optin')).getBoundingClientRect();
        const atTick = document.elementFromPoint(label.left + 40, label.bottom - 1);
        return { drawn: Math.round(r.height), height: reach(0, -1) + reach(0, 1) + 1,
                 tickKeepsItsEdge: !!atTick?.closest('.banner-optin') };
    });
    expect(m.height, `the tap target (drawn ${m.drawn}px)`).toBeGreaterThanOrEqual(24);
    expect(m.tickKeepsItsEdge, 'the opt-in above keeps its own bottom edge').toBe(true);
});

test('paycalc: the rate badges print in their own colours, RDW included', async ({ page }) => {
    // Every fill prints here (the print block's `*` keeps them), so the seven badges need no print
    // rules of their own — except RDW: the calendar's shift badge shares the name, and shared.css's
    // print rule for it would paint Pay's pale chip solid navy-teal with white words.
    await seedSession(page);
    await page.addInitScript(() => localStorage.setItem('myb_pc_ns_migrated', '1'));
    await page.goto('/paycalc.html');
    await expect(page.locator('#netDisplay')).toHaveText(/£\d/);
    const paint = () => page.locator('.rate-badge').evaluateAll(els => els.map(el => {
        const cs = getComputedStyle(el); return `${el.className}: ${cs.backgroundColor} / ${cs.color}`;
    }));
    const screen = await paint();
    expect(screen.some(s => s.includes('badge-rdw')), 'the premise: the RDW badge is on the page').toBe(true);
    await page.emulateMedia({ media: 'print' });
    const paper = await paint();
    await page.emulateMedia({ media: null });
    expect(paper).toEqual(screen);
});

// The sheet's header names the payslip as the page does — "Paid 20 November 2026" — never "20 Nov 26"
// (17 Nov 2026): the result card and the picker both spell the year out.
test('paycalc: the printed header names the payday with its whole year', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-11-17T09:00:00Z'));
    await seedSession(page);
    await page.addInitScript(() => localStorage.setItem('myb_pc_ns_migrated', '1'));
    await page.goto('/paycalc.html?payday=2026-11-20');
    await expect(page.locator('#netDisplay')).toHaveText(/£\d/);
    await expect(page.locator('.app-header')).toHaveAttribute('data-print-line', /^Paid 20 November 2026 \(P\d+\) · /);
});

// ── THE DESKTOP AUDIT (7 Nov 2026) ──────────────────────────────────────────────────────────────
// A laptop with a keyboard and a mouse — the station PC's shape. Each test pins one finding by what a
// member meets there: where Tab goes, what it can reach, what the pointer does to what it points at.
// July is the audit's own day (the visual harness's): P20, seventeen rows into a 26-row period list,
// with Saturday and Sunday shifts the calendar row can match.

/** Every stop the REAL Tab key makes from the top of the page until focus leaves it, measured after
 *  the scroll it causes has settled — the take-home bar follows that scroll a frame later. */
async function tabStops(page, { settleBar = false } = {}) {
    const stops = [];
    let waitForBar = settleBar;
    for (let i = 0; i < 150; i++) {
        await page.keyboard.press('Tab');
        await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
        // A walk that reads the bar waits for it to agree with where the £ now is: WebKit, with the
        // clock pinned, gets there a few stops late. A bar that misses a second is not waited on
        // again, and the assertions judge it as it stands. 8px is the bar's TOP_INSET.
        if (waitForBar) await page.waitForFunction(() => {
            const bar = document.getElementById('stickyTotal');
            const net = document.getElementById('netDisplay')?.getBoundingClientRect();
            if (!bar || !net) return true;
            return bar.classList.contains('visible')
                ? net.bottom <= 9 || net.top >= innerHeight - 1
                : net.bottom >= 7 && net.top <= innerHeight + 1;
        }, null, { timeout: 1000, polling: 50 }).catch(() => { waitForBar = false; });
        const stop = await page.evaluate(() => {
            const el = document.activeElement;
            if (!el || el === document.body) return null;
            const r = el.getBoundingClientRect();
            const bar = /** @type {HTMLElement} */ (document.getElementById('stickyTotal'));
            const barUp = bar.classList.contains('visible') && el !== bar;
            const b = bar.getBoundingClientRect();
            return {
                id: el.id || `${el.tagName.toLowerCase()}.${el.className}`,
                shut: !!el.closest('.collapsible-body:not(.open)'),
                region: el.closest('#settingsCard') ? 'settings' : el.closest('.period-controls') ? 'band'
                    : el.closest('#hoursCard') ? 'hours' : 'other',
                barUp,
                under: barUp ? Math.max(0, Math.round(Math.min(r.bottom, b.bottom) - Math.max(r.top, b.top))) : 0,
            };
        });
        if (!stop) break;
        stops.push(stop);
    }
    return stops;
}

// PAY1 — the collapsed cards hid their bodies from the EYE only: 20 of 61 Tab stops sat inside them,
// and one Space on the unseen "not in the pension scheme" tick moved the take-home with the card shut.
test('paycalc: a shut card keeps its controls out of the Tab order and the accessibility tree', async ({ page }, info) => {
    test.skip(isTouchProject(info), 'a keyboard walk at a laptop size');
    await openReturning(page);
    await expect(page.locator('#settingsBody')).not.toHaveClass(/open/);
    // The tick that moved the £: neither reachable nor named while its card is shut.
    await expect(page.locator('#pensionOptOutCheck')).toBeHidden();
    await expect(page.getByRole('checkbox', { name: /not in the pension scheme/i })).toHaveCount(0);

    const stops = await tabStops(page);
    expect(stops.length, 'the walk must reach the foot of the page to prove anything').toBeGreaterThan(25);
    expect(stops.filter(s => s.shut).map(s => s.id), 'no Tab stop inside a shut card').toEqual([]);

    // Opening the card gives its fields back: from its arrow, the next Tab lands inside it.
    await page.locator('#settingsToggle .card-toggle-arrow').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#settingsBody')).toHaveClass(/open/);
    await page.keyboard.press('Tab');
    await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('#settingsBody')),
        { message: 'Tab from the open card\'s arrow goes into the card' }).toBe(true);
    await expect(page.getByRole('checkbox', { name: /not in the pension scheme/i })).toHaveCount(1);
});

// …and the save's own close, 2.5s after "Save settings", must not strand a keyboard member's focus on
// a button that has just left the Tab order: it hands focus to the arrow that reopens the card.
test('paycalc: Settings saved from the keyboard hands focus to its arrow as it closes', async ({ page }, info) => {
    test.skip(isTouchProject(info), 'a keyboard path');
    await page.clock.setFixedTime(AUDIT_DAY);
    await page.setViewportSize({ width: 1366, height: 768 });
    await seedSession(page);
    await page.addInitScript(PT_QUIET);   // a first visit, so the card is open with its Save button
    await page.goto('/paycalc.html');
    await payPageReady(page);
    await page.locator('#saveSettingsBtn').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#settingsBody')).not.toHaveClass(/open/, { timeout: 5000 });
    await expect(page.locator('#settingsToggle .card-toggle-arrow')).toBeFocused();
});

// PAY2 — on a desktop CSS `order` drew Settings last and left it FIRST in the DOM, so Tab went from the
// header to Your Settings at the foot of the page before coming back up to the tax-year tabs.
test('paycalc: on a desktop Tab follows the page — the period band and Hours before Your Settings', async ({ page }, info) => {
    test.skip(isTouchProject(info), 'a keyboard walk at a laptop size');
    await openReturning(page);
    const stops = await tabStops(page);
    const regions = stops.map(s => s.region);
    expect(regions.indexOf('band'), 'the period band is reached').toBeGreaterThan(-1);
    expect(regions.indexOf('band'), 'the tax-year tabs come before anything in Your Settings')
        .toBeLessThan(regions.indexOf('settings'));
    expect(regions.lastIndexOf('hours'), 'and the whole of Hours').toBeLessThan(regions.indexOf('settings'));
    expect(stops[regions.indexOf('band')].id).toBe('tyTab0');

    // The order is the DOM's, so it has to follow the breakpoint both ways: below 1024px the card
    // leads the work column's cards again (only the notes that head the page come before it), as a
    // first-time member on a phone meets it.
    await page.setViewportSize({ width: 900, height: 900 });
    await expect.poll(() => page.evaluate(() => document.querySelector('.period-controls')?.previousElementSibling?.id)).toBe('settingsCard');
    await page.setViewportSize({ width: 1366, height: 768 });
    await expect.poll(() => page.evaluate(() => document.getElementById('hoursCard')?.nextElementSibling?.id)).toBe('settingsCard');
});

// PAY3 — the browser scrolls a newly focused control only just into view, which at the foot of the page
// put it under the fixed bar (the Move Your Pay Data arrow 84% covered, the guide link 95%); and the
// bar's own ring was navy on its navy fill.
test('paycalc: a control reached with Tab is never under the take-home bar, and the bar shows its own ring', async ({ page }, info) => {
    test.skip(isTouchProject(info), 'a keyboard walk at a laptop size');
    await openReturning(page);   // 1366×768, the audit's size: the foot of the page meets the bar
    const stops = await tabStops(page, { settleBar: true });
    expect(stops.some(s => s.barUp), 'the bar must be up for part of the walk, or this proves nothing').toBe(true);
    expect(stops.filter(s => s.under > 0).map(s => `${s.id}: ${s.under}px under the bar`)).toEqual([]);

    await page.locator('#disclaimerToggle').focus();
    await expect(page.locator('#stickyTotal'), 'at the foot of the page the bar is up, and so a Tab stop').toBeVisible();
    await page.keyboard.press('Tab');
    await expect(page.locator('#stickyTotal')).toBeFocused();
    const ring = await page.evaluate(() => {
        const probe = document.createElement('div');
        probe.style.outline = 'var(--focus-outline-light)';
        document.body.appendChild(probe);
        const want = getComputedStyle(probe).outlineColor;
        probe.remove();
        const s = getComputedStyle(/** @type {HTMLElement} */ (document.getElementById('stickyTotal')));
        return { want, colour: s.outlineColor, style: s.outlineStyle, offset: parseFloat(s.outlineOffset), fill: s.backgroundColor };
    });
    expect(ring.style).toBe('solid');
    expect(ring.colour, 'the light token, which shows on the bar\'s navy').toBe(ring.want);
    expect(ring.colour).not.toBe(ring.fill);
    expect(ring.offset, 'drawn inside the bar: its bottom edge is the window\'s').toBeLessThan(0);
});

// PAY5 — the setup banner asked a member to check "⚙️ Your Settings below", and on a desktop the card is
// ~1,450px below it. The words are a link now, and it opens the card even after it was shut.
test('paycalc: the setup banner\'s "Your Settings" opens the card and brings it up', async ({ page }, info) => {
    test.skip(isTouchProject(info), 'the distance is a desktop one');
    await page.clock.setFixedTime(AUDIT_DAY);
    await page.setViewportSize({ width: 1366, height: 768 });
    await seedSession(page);
    await page.addInitScript(PT_QUIET);   // a first visit: nothing saved, so the banner asks
    await page.goto('/paycalc.html');
    await payPageReady(page);
    const link = page.locator('#setupBanner a[href="#settingsCard"]');
    await expect(link).toBeVisible();
    await expect(page.locator('#setupBannerBody')).not.toContainText(/\btap\b/i);
    await page.locator('#settingsToggle .card-toggle-arrow').click();
    await expect(page.locator('#settingsBody')).not.toHaveClass(/open/);
    await page.evaluate(() => window.scrollTo(0, 0));

    await link.click();
    await expect(page.locator('#settingsBody')).toHaveClass(/open/);
    await expect(page.locator('#gradeSelectTrigger'), 'focus on the first thing the banner asks about').toBeFocused();
    await expect.poll(async () => Math.round((await page.locator('#settingsCard').boundingBox())?.y ?? 9999),
        { message: 'the card is brought up to the top of the screen' }).toBeLessThan(768 / 3);
});

// PAY6 — the `?` sheet grew to 620px on a desktop while Settings' `?` opens at the Tips' 340, beside an
// overlay scale that allows three widths and one cap. It is the Tips' width at every size now.
test('paycalc: the ? help sheet is the Tips\' width at every size', async ({ page }) => {
    await openReturning(page);
    for (const width of [1366, 820, 390]) {
        await page.setViewportSize({ width, height: 800 });
        await page.locator('#hoursCard .help-btn').click();
        await expect(page.locator('#tipsLightbox')).toHaveClass(/open/);
        const w = await page.evaluate(() => {
            const probe = document.createElement('div');
            probe.style.cssText = 'position:absolute;width:min(var(--modal-standard), var(--modal-cap))';
            document.body.appendChild(probe);
            const want = probe.offsetWidth;
            probe.remove();
            return { want, got: /** @type {HTMLElement} */ (document.getElementById('tipsLightboxContent')).offsetWidth };
        });
        expect(w.got, `the sheet at ${width}px`).toBe(w.want);
        await page.keyboard.press('Escape');
        await expect(page.locator('#tipsLightbox')).not.toHaveClass(/visible/);
    }
});

// THE ? PANELS ARE THE SHARED TIPS SHEET (owner-approved, Nov 2026). They were a see-through glass sheet
// (white at 9% over the page) of bullet lists, so the page's own text showed through behind the help —
// confirmed on an iPhone. Now: the white sheet, the fixed title and ✕, section headings and icon rows
// every other page's ? opens. And because one sheet serves all five buttons, a panel scrolled to its end
// left the NEXT one opening part-way down, its first heading out of sight; each opens at its top now.
test('paycalc: each ? opens the white Tips sheet, headed and at its top', async ({ page }) => {
    await openReturning(page, { width: 375, height: 667 });
    const sheet = page.locator('#tipsLightboxContent');
    for (const key of ['settings', 'hours', 'accuracy', 'hpp', 'backpay']) {
        await page.locator(`.help-btn[data-help="${key}"]`).click();
        await expect(page.locator('#tipsLightbox'), key).toHaveClass(/open/);
        await expect(page.locator('#tipsLbTitle'), key).not.toBeEmpty();
        // Opaque: nothing of the page can show through it.
        expect(await sheet.evaluate(e => getComputedStyle(e).backgroundColor), `${key}: an opaque sheet`).toBe('rgb(255, 255, 255)');
        await expect(page.locator('#tipsLbBody .tips-lb-section').first(), `${key}: sections are headed`).toBeVisible();
        expect(await page.locator('#tipsLbBody .tips-lb-item .tips-lb-icon').count(), `${key}: every row has its icon`)
            .toBe(await page.locator('#tipsLbBody .tips-lb-item').count());
        expect(await sheet.evaluate(e => e.scrollTop), `${key}: opens at its top`).toBe(0);
        // Leave it scrolled to its end, as a member who read it all would, for the next one to open after.
        await sheet.evaluate(e => { e.scrollTop = e.scrollHeight; });
        expect(await sheet.evaluate(e => e.scrollTop), `premise: ${key}'s panel scrolls on a phone`).toBeGreaterThan(0);
        await page.keyboard.press('Escape');
        await expect(page.locator('#tipsLightbox')).not.toHaveClass(/visible/);
    }
});

// PAY9 — a 3px navy stripe on two notes that sit on the navy canvas: no stripe at all, only a white
// edge 3px inside every other card's.
test('paycalc: the notes on the navy canvas carry no navy stripe', async ({ page }) => {
    await openReturning(page);
    for (const sel of ['.disclaimer', '#privacyNoteTop']) {
        expect(await page.locator(sel).evaluate(el => getComputedStyle(el).borderLeftWidth), sel).toBe('0px');
    }
});

// PAY10 — capped at 1,100px, the take-home bar had no edge on the navy canvas, and `space-between`
// put its label ~760px from the £ it names.
test('paycalc: on a desktop the take-home bar has an edge, and its label sits beside the £', async ({ page }, info) => {
    test.skip(isTouchProject(info), 'the capped bar is a desktop one');
    await openReturning(page);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect(page.locator('#stickyTotal')).toBeVisible();
    const g = await page.evaluate(() => {
        const bar = /** @type {HTMLElement} */ (document.getElementById('stickyTotal'));
        // The label's WORDS, not its box: a label left to grow fills the bar and still ends at the £.
        const words = document.createRange();
        words.selectNodeContents(/** @type {HTMLElement} */ (document.getElementById('stickyLabel')));
        const amount = /** @type {HTMLElement} */ (document.getElementById('stickyAmount')).getBoundingClientRect();
        const probe = document.createElement('div');
        probe.style.color = 'var(--on-navy-hairline)';
        document.body.appendChild(probe);
        const hairline = getComputedStyle(probe).color;
        probe.remove();
        const s = getComputedStyle(bar);
        return { gap: Math.round(amount.left - words.getBoundingClientRect().right), edge: s.borderTopWidth, edgeColour: s.borderTopColor, hairline };
    });
    expect(g.gap, 'the label sits beside its £').toBeLessThan(40);
    expect(g.edge).toBe('1px');
    expect(g.edgeColour).toBe(g.hairline);
});

// PAY11 — six period-band controls and notes were --type-micro (10px), read at arm's length on a laptop,
// and first bumped for a mouse only. A phone at arm's length reads them no better, so they are the
// small step on every pointer (polish pass, Nov 2026).
test('paycalc: the period band\'s small print is the small step on every device', async ({ page }) => {
    await openReturning(page);
    const sizes = await page.evaluate(() => ['#saveStatus', '#clearBtn', '#rosterViewLink', '.period-hint', '#rosterDaysToggle', '#periodBadge']
        .map(sel => getComputedStyle(/** @type {Element} */ (document.querySelector(sel))).fontSize));
    expect(sizes).toEqual(Array(6).fill('12px'));
});

// PAY12 — "tap" in words a mouse and a keyboard read. Swept on the page a desktop first visit meets,
// with the Hours help open and the corrections row showing.
test('paycalc: nothing a mouse or a keyboard reads says "tap"', async ({ page }, info) => {
    test.skip(isTouchProject(info), 'the touch words are for touch');
    await page.clock.setFixedTime(AUDIT_DAY);
    await page.setViewportSize({ width: 1366, height: 768 });
    await seedSession(page);
    await page.addInitScript(PT_QUIET);
    await page.goto('/paycalc.html');
    await payPageReady(page);
    await page.locator('#hoursShowMore').click();
    await page.locator('#hoursCard .help-btn').click();
    await expect(page.locator('#tipsLightbox')).toHaveClass(/open/);
    const words = await page.evaluate(() => [document.body.innerText,
        ...[...document.querySelectorAll('[aria-label]')].map(e => e.getAttribute('aria-label'))].join('\n'));
    expect(words.match(/[^\n]*\btap(s|ped|ping)?\b[^\n]*/gi) ?? []).toEqual([]);
});
