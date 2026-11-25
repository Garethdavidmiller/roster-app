/**
 * paycalc-notices.spec.js — the Pay Calculator (paycalc.html): the notices and the Holiday Pay Premium
 * — the January pointer, the Year to Date and premium notices, and a joiner's premium.
 *
 * Split by feature out of paycalc.spec.js on 25 Nov 2026, test for test and unchanged; what more than
 * one paycalc-*.spec.js file needs is in paycalc-helpers.js, including the roster rows these tests sign
 * in as, which are chosen by shape and never written down (payroll-anonymity.test.mjs).
 */
import { test, expect } from './fixtures.js';
import { collectFatalErrors, seedSession } from './helpers.js';
import { memberSlug } from '../paycalc-migrations.js';
import { JOINER, LONG_SERVING, LONG_SERVING_PC, PAY_2026_27_DAY } from './paycalc-helpers.js';

const JOINER_PC = `myb_pc_${memberSlug(JOINER)}_`;

// ── THE JANUARY POINTER POINTS AT A BOX THAT CAN TAKE THE FIGURE (whole-app check, 10 Nov 2026) ──
// The Year to Date card's "enter the confirmed figure from it in the Holiday Pay Premium card"
// showed on the January payslip whatever that card could do: before the payslip was paid, when the
// confirm box is locked, and to a member who joined after that premium's year, for whom the whole
// last-year section is hidden. 15 Jan 2027 (p60) carries the 2025/26 premium.
const JAN_2027_PAID_DAY = new Date('2027-01-20T09:00:00Z');

test('paycalc: the January premium pointer waits for the payslip, then points at an open box', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.clock.setFixedTime(PAY_2026_27_DAY);   // 7 Nov 2026 — the 15 Jan 2027 payslip is months away
    await seedSession(page);
    await page.goto('/paycalc.html');
    await expect(page.locator('#netDisplay')).toHaveText(/£\d/);
    await page.locator('#periodSelect').selectOption('60');
    await expect(page.locator('#periodSelect')).toHaveValue('60');
    await expect(page.locator('#priorHppActualInput'), 'premise: the confirm box is locked').toBeDisabled();
    await expect(page.locator('#ytdJanHppHint')).toHaveJSProperty('hidden', true);

    // From its cut-off (9 Jan) the payslip may be in hand, which is when the box opens (paycalc-2-3).
    await page.clock.setFixedTime(new Date('2027-01-12T09:00:00Z'));
    await page.reload();
    await expect(page.locator('#netDisplay')).toHaveText(/£\d/);
    await page.locator('#periodSelect').selectOption('60');
    await expect(page.locator('#ytdJanHppHint')).toHaveJSProperty('hidden', false);

    // Once the payslip is paid the box opens, and the pointer to it shows.
    await page.clock.setFixedTime(JAN_2027_PAID_DAY);
    await page.reload();
    await expect(page.locator('#netDisplay')).toHaveText(/£\d/);
    await page.locator('#periodSelect').selectOption('60');
    await expect(page.locator('#priorHppActualInput')).toBeEnabled();
    await expect(page.locator('#ytdJanHppHint')).toHaveJSProperty('hidden', false);
    await page.locator('#payslipCardToggle .card-toggle-arrow').click();
    await expect(page.locator('#ytdJanHppHint')).toBeVisible();

    expect(errors, `fatal errors: ${errors.join(', ')}`).toHaveLength(0);
});

// ── THE PASS THAT STORES LAST YEAR'S PREMIUM ALSO OFFERS IT (whole-app check, 10 Nov 2026) ─────────
// calculate() read last year's stored premium for the January banner, then ran calcHPP — which is
// what works that premium out and stores it when nothing is stored yet (updatePriorHpp). So the pass
// that stored it painted the banner from nothing, and the HPP card and the banner disagreed until
// something else recalculated. Something else usually does — a second pass follows a page load or a
// change of payslip (the back-pay card re-prices) — which is why only the ORDER can be asserted: the
// stored figure is taken away first, standing in for a premium not yet worked out, and the banner
// must show within the pass that works it out, before the take-home £ is written a second time.
test('paycalc: the January banner offers last year\'s premium on the pass that works it out', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.clock.setFixedTime(new Date('2026-12-10T09:00:00Z'));   // opens on 18 Dec 2026 (p59)
    await seedSession(page, LONG_SERVING);
    const sat = JSON.stringify({ satH: 40, satM: 0, bhH: 0, bhM: 0, bhOtH: 0, bhOtM: 0, otH: 0, otM: 0, rdwH: 0, rdwM: 0,
        sunH: 0, sunM: 0, boxH: 0, boxM: 0, peer: 0, slSkip: false, otherAdj: 0, actualNet: null });
    await page.addInitScript(({ seed, pc }) => {
        localStorage.setItem('myb_pc_ns_migrated', '1');
        localStorage.setItem('myb_pc_ytd_notice_2_shown', '1');
        localStorage.setItem(`${pc}grade`, 'cea');
        localStorage.setItem(`${pc}setup`, '1');
        localStorage.setItem(`${pc}p45`, seed);   // a 2025/26 payslip with premium hours
    }, { seed: sat, pc: LONG_SERVING_PC });
    await page.goto('/paycalc.html');
    await expect(page.locator('#netDisplay')).toHaveText(/£\d/);
    await expect(page.locator('#periodSelect')).toHaveValue('59');
    await page.evaluate((pc) => {
        localStorage.removeItem(`${pc}hpp_est_2025_26`);
        // One ordered log of every pass's take-home write and every banner show/hide.
        const log = /** @type {string[]} */ ([]);
        Object.assign(window, { __passLog: log });
        const net = /** @type {HTMLElement} */ (document.getElementById('netDisplay'));
        const banner = /** @type {HTMLElement} */ (document.getElementById('hppActiveBanner'));
        new MutationObserver(records => {
            for (const r of records) log.push(r.target === banner ? `banner:${banner.style.display || 'shown'}` : 'net');
        }).observe(net, { childList: true, characterData: true, subtree: true });
        new MutationObserver(() => log.push(`banner:${banner.style.display || 'shown'}`))
            .observe(banner, { attributes: true, attributeFilter: ['style'] });
    }, LONG_SERVING_PC);

    await page.locator('#periodSelect').selectOption('60');   // 15 Jan 2027 — carries the 2025/26 premium
    await expect(page.locator('#priorHppAmt'), 'premise: the pass worked the premium out').toHaveText(/£\d/);
    const premium = (await page.locator('#priorHppAmt').textContent() ?? '').trim();
    await expect(page.locator('#hppActiveBanner')).toBeVisible();
    await expect(page.locator('#hppBannerText')).toContainText(`Estimated Holiday Pay Premium of ${premium}`);
    const log = /** @type {string[]} */ (await page.evaluate(() => /** @type {any} */ (window).__passLog));
    const firstShown = log.indexOf('banner:shown');
    const secondNet = log.indexOf('net', log.indexOf('net') + 1);
    expect(firstShown, `the banner never showed: ${log.join(' ')}`).toBeGreaterThan(-1);
    expect(secondNet === -1 || firstShown < secondNet,
        `the banner waited for another pass to offer what this one worked out: ${log.join(' ')}`).toBe(true);
    expect(errors, `fatal errors: ${errors.join(', ')}`).toHaveLength(0);
});

test('paycalc: a joiner is not pointed at last year\'s premium, which the card hides from them', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.clock.setFixedTime(JAN_2027_PAID_DAY);
    await seedSession(page, JOINER);   // started 5 May 2026 — employed for none of 2025/26
    await page.addInitScript((pc) => {
        localStorage.setItem('myb_pc_ns_migrated', '1');
        localStorage.setItem(`${pc}grade`, 'cea');
        localStorage.setItem(`${pc}setup`, '1');
    }, JOINER_PC);
    await page.goto('/paycalc.html');
    await expect(page.locator('#netDisplay')).toHaveText(/£\d/);
    await page.locator('#periodSelect').selectOption('60');
    await expect(page.locator('#periodSelect')).toHaveValue('60');
    await expect(page.locator('#priorHppSection'), 'premise: the last-year section is hidden from a joiner').toHaveClass(/hidden/);
    await expect(page.locator('#ytdJanHppHint')).toHaveJSProperty('hidden', true);

    expect(errors, `fatal errors: ${errors.join(', ')}`).toHaveLength(0);
});

// The Pay page's re-posted Year to Date notice runs 90 days from 28 Aug 2026 — to 23:00 on 25 Nov
// (`isNoticeExpired('28 Aug 2026', 90)`). The two tests below are about that notice, so they pin the
// clock inside its life, as the Calendar's notice tests further down do. On the real clock they would
// have turned the release gate red on 26 Nov: from then the notice never opens, so the second test
// fails and the first ("…and alone") passes whatever the code does (test audit, 7 Nov 2026 — proved
// with the clock pinned to 20 and 27 Nov). When the notice is retired, these two go with it.
const PAY_YTD_NOTICE_LIVE = new Date('2026-10-22T09:00:00Z');

test('paycalc: the data-ownership prompt opens for legacy data, and alone', async ({ page }) => {
    await page.clock.setFixedTime(PAY_YTD_NOTICE_LIVE);
    await seedSession(page);   // signs in as a real member (G. Miller)
    await page.addInitScript(() => {
        // Genuine unnamespaced legacy pay data → migration pending.
        localStorage.setItem('myb_pc_rate', '20.74');
        localStorage.removeItem('myb_pc_ns_migrated');
        // The YTD notice is live again and would otherwise be the second overlay. Left UNSET on
        // purpose — suppressing it here would be suppressing the thing under test.
        localStorage.removeItem('myb_pc_ytd_notice_2_shown');
    });
    await page.goto('/paycalc.html');

    await expect(page.locator('#dataOwnerLightbox.visible')).toBeVisible();
    await expect(page.locator('.lb-overlay.visible'), 'exactly one overlay open').toHaveCount(1);
    // And specifically not the lower-stakes one: a prompt about copying two figures off a payslip
    // must never sit in front of a decision about whose pay data this device is holding.
    await expect(page.locator('#noticeYtdLightbox.visible')).toHaveCount(0);

    // Both answers must read as BUTTONS on the navy sheet (desktop audit, Nov 2026): the primary was
    // navy on navy, 1:1, so "Yes, it's mine" was words with no button round them. 3:1 is WCAG's floor
    // for a control's edge. A canvas reads each computed colour back as RGB, whatever its notation.
    const edges = await page.evaluate(() => {
        const ctx = /** @type {CanvasRenderingContext2D} */ (document.createElement('canvas').getContext('2d'));
        // Painted OVER a ground (the sheet), so a see-through colour reads as it is seen, not as its pure hue.
        const rgb = (/** @type {string} */ c, ground = 'black') => { ctx.fillStyle = ground; ctx.fillRect(0, 0, 1, 1); ctx.fillStyle = c; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3); };
        const lum = (/** @type {number[]} */ c) => c.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; })
            .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
        const sheetColour = getComputedStyle(/** @type {Element} */ (document.getElementById('dataOwnerContent'))).backgroundColor;
        const sheet = lum(rgb(sheetColour));
        // A button's EDGE: its fill — or, where the fill lets the sheet through (the outlined secondary, 24 Nov 2026),
        // its border, painted over the sheet.
        const edge = (/** @type {string} */ id) => {
            const cs = getComputedStyle(/** @type {Element} */ (document.getElementById(id)));
            const seeThrough = /^rgba\(.*,\s*0\)$|^transparent$/.test(cs.backgroundColor);
            return lum(rgb(seeThrough && parseFloat(cs.borderTopWidth) >= 1 ? cs.borderTopColor : cs.backgroundColor, sheetColour));
        };
        return ['dataOwnerMine', 'dataOwnerFresh'].map(id => {
            const [hi, lo] = [edge(id), sheet].sort((a, b) => b - a);
            return { id, ratio: Math.round((hi + 0.05) / (lo + 0.05) * 100) / 100 };
        });
    });
    for (const { id, ratio } of edges) expect(ratio, `#${id} against the navy sheet`).toBeGreaterThanOrEqual(3);

    // WHAT THIS CAN AND CANNOT CATCH, measured by mutation rather than assumed. Two INDEPENDENT
    // guards keep the notice out: `_ownerPending` (will-open) and `openNoticeIfClear` (is-open).
    // Removing EITHER leaves this test green, because the other still holds — so a single-guard
    // regression is invisible here. Removing BOTH fails it. That is the honest description: the
    // assertion is live and watching the right thing, and the redundancy is the product being
    // well built rather than the test being weak. Do not "simplify" by deleting one guard on the
    // evidence that the suite stays green; it will.
});

// The other half: on a device with nothing competing, the re-posted notice DOES appear. Without this
// the test above passes just as well against a notice that is broken and never opens at all — which
// is the state it was actually in from 5 Jul, and which nothing detected.
test('paycalc: the re-posted YTD notice appears on a clean device', async ({ page }) => {
    await page.clock.setFixedTime(PAY_YTD_NOTICE_LIVE);
    await seedSession(page);
    await page.addInitScript(() => {
        localStorage.setItem('myb_pc_ns_migrated', '1');          // no ownership prompt
        localStorage.removeItem('myb_pc_ytd_notice_2_shown');     // not yet seen on this device
    });
    await page.goto('/paycalc.html');

    await expect(page.locator('#noticeYtdLightbox.visible')).toBeVisible();
    // Closing it flags the device, and the flag is the NEW key — re-dating the old one would have
    // reached nobody, because every device that arrived after the first run expired already carries
    // it, set by the silent-expiry branch without ever showing the notice.
    await page.locator('#noticeYtdClose').click();
    await expect.poll(() => page.evaluate(() => localStorage.getItem('myb_pc_ytd_notice_2_shown')))
        .toBe('1');
});


// ── The Holiday Pay Premium notice (hpp_2526, owner 16 Nov 2026 — v26.22) ─────────────────────────
// Second in the Pay page's sequence: the load AFTER the Year to Date notice, never the same one. It is
// for a member with a 2025/26 payslip and no figure of their own for that year's premium yet, and its
// link opens the last 2025/26 payslip with the Year to Date card open, where the one figure the rough
// estimate needs is typed. Its wiring is pinned in paycalc-notice-order.test.mjs and its reader and
// dates in paycalc-hpp.test.mjs; these are the halves only a browser proves — the order across real
// loads, the landing, the route ending in a figure under "Last year (2025/26)", and the refusals.
// Clock pinned inside both notices' lives: the Year to Date notice runs to ~26 Nov.
const HPP_NOTICE_DAY = new Date('2026-11-20T09:00:00Z');
/** The established seed: a CEA with no start date, so employed the whole of 2025/26. */
const HPP_MEMBER = 'G. Miller';
/** Started 5 May 2026, so employed for none of 2025/26 (the joiner the tests above use). */
const HPP_JOINER = JOINER;

/**
 * A member signed in on `day` with neither Pay notice answered. Not `seedSession`, which marks both
 * done on every load — `extra` keys are set on every load instead, and nothing else is.
 * @param {import('@playwright/test').Page} page @param {Date} day
 * @param {string} [name] @param {Record<string, string>} [extra]
 */
async function payMemberWithNoNoticeAnswered(page, day, name = HPP_MEMBER, extra = {}) {
    await page.clock.setFixedTime(day);
    await page.addInitScript(({ n, kv }) => {
        localStorage.setItem('myb_admin_session', JSON.stringify({ name: n, ver: 2, expiry: Date.now() + 90 * 24 * 60 * 60 * 1000 }));
        localStorage.setItem('myb_pc_ns_migrated', '1');   // no ownership prompt
        for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v);
    }, { n: name, kv: extra });
}
const HPP_FLAG = 'myb_pc_hpp_notice_2526_shown';
const hppFlag = (/** @type {import('@playwright/test').Page} */ page) => page.evaluate(k => localStorage.getItem(k), HPP_FLAG);

test('paycalc: the Holiday Pay Premium notice comes the load after the Year to Date notice, never the same one (v26.22)', async ({ page }) => {
    test.setTimeout(60_000);
    const errors = collectFatalErrors(page);
    await payMemberWithNoNoticeAnswered(page, HPP_NOTICE_DAY);
    await page.goto('/paycalc.html');
    await expect(page.locator('#noticeYtdLightbox.visible')).toBeVisible();
    await page.locator('#noticeYtdClose').click();
    await expect(page.locator('#noticeYtdLightbox.visible')).toHaveCount(0);
    await page.waitForTimeout(2000);
    await expect(page.locator('.lb-overlay.visible'), 'nothing follows the Year to Date notice on its own load').toHaveCount(0);
    expect(await hppFlag(page), 'and the premium notice is still owed').toBeNull();

    await page.reload();
    await expect(page.locator('#noticeHppLightbox.visible')).toBeVisible();
    await expect(page.locator('.lb-overlay.visible'), 'exactly one overlay open').toHaveCount(1);
    // What it teaches: the premium, the year, the payslip, the figure on it, and where that goes.
    const notice = page.locator('#noticeHppContent');
    for (const words of ['Holiday Pay Premium', '2025/26', '13 March 2026', 'Taxable Pay', 'Rough estimate from your Year to Date pay']) {
        await expect(notice).toContainText(words);
    }
    // "Not now" answers it for good, and App Notices keeps it — archived as it opened.
    await page.locator('#noticeHppLater').click();
    await expect(page.locator('#noticeHppLightbox.visible')).toHaveCount(0);
    expect(await hppFlag(page)).toBe('1');
    const archived = await page.evaluate(() => JSON.parse(localStorage.getItem('myb_app_notices') || '[]').map((/** @type {any} */ n) => n.id));
    expect(archived).toContain('hpp_2526');
    await page.reload();
    await expect(page.locator('#netDisplay')).toHaveText(/£\d/);
    await page.waitForTimeout(2000);
    await expect(page.locator('.lb-overlay.visible'), 'answered: nothing more').toHaveCount(0);
    expect(errors).toHaveLength(0);
});

test('paycalc: the premium notice\'s link opens the last 2025/26 payslip, and its route gives last year\'s premium a figure (v26.22)', async ({ page }) => {
    test.setTimeout(60_000);
    const errors = collectFatalErrors(page);
    await payMemberWithNoNoticeAnswered(page, HPP_NOTICE_DAY, HPP_MEMBER, { myb_pc_ytd_notice_2_shown: '1' });
    await page.goto('/paycalc.html');
    await expect(page.locator('#noticeHppLightbox.visible')).toBeVisible();
    await page.locator('#noticeHppGo').click();
    await page.waitForURL(/\/paycalc\.html\?payday=2026-03-13#payslipCard$/);

    // The payslip whose Year to Date box holds the whole of 2025/26, its card open, nothing over it.
    await expect(page.locator('#periodSelect')).toHaveValue('49');
    await expect(page.locator('#payslipCardBody')).toHaveClass(/open/);
    await expect(page.locator('#netDisplay')).toHaveText(/£\d/);
    await page.waitForTimeout(1500);
    await expect(page.locator('.lb-overlay.visible')).toHaveCount(0);
    expect(await hppFlag(page), 'its link answered it').toBe('1');

    // The two steps it names: the Taxable Pay into the Year to Date card, then the rough estimate.
    await page.fill('#ytdPay', '45000');
    await page.dispatchEvent('#ytdPay', 'input');
    await page.locator('#hppCardToggle .card-toggle-arrow').click();
    await expect(page.locator('#hppCardBody')).toHaveCSS('visibility', 'visible');
    await page.locator('#hppModeYtd').check();
    const amount = page.locator('#hppAmount');
    await expect(amount).toHaveText(/^£\d/);
    const figure = /** @type {string} */ (await amount.textContent());
    // And it says what it cannot take out: last January's premium is inside that Taxable Pay too.
    await expect(page.locator('#hppBasis')).toContainText('Holiday Pay Premium on your 16 January 2026 payslip');

    // Back on this year's payslip, "Last year (2025/26)" carries that figure to January, and names it.
    await page.goto('/paycalc.html');
    await expect(page.locator('#netDisplay')).toHaveText(/£\d/);
    await page.locator('#hppCardToggle .card-toggle-arrow').click();
    await expect(page.locator('#priorHppTitle')).toHaveText('Last year (2025/26)');
    await expect(page.locator('#priorHppAmt')).toHaveText(figure);
    await expect(page.locator('#priorHppBasis')).toContainText('Rough estimate from your 2025/26 Year to Date pay · due January 2027');
    await expect(page.locator('#noticeHppLightbox.visible'), 'answered by its link, it stays away').toHaveCount(0);
    expect(errors).toHaveLength(0);
});

// ONE BACK FROM THE PAYSLIP THE LINK OPENED LEAVES THE NOTICE BEHIND (18 Nov 2026). The link was a plain <a href>,
// so the payslip stacked on the open notice's history entry: Back came back to that entry, and — the page reloaded,
// with nothing left to answer it — the Back after that did nothing. The link now REPLACES the notice's entry, as the
// Calendar's notices and the drawer's links do (overlay.js `followLinkOutOf`). Playwright runs with the back/forward
// cache off, so Back always reloads here.
test('paycalc: one Back from the payslip the premium notice opened leaves the notice behind, and the next Back leaves Pay', async ({ page }) => {
    test.setTimeout(60_000);
    const errors = collectFatalErrors(page);
    await payMemberWithNoNoticeAnswered(page, HPP_NOTICE_DAY, HPP_MEMBER, { myb_pc_ytd_notice_2_shown: '1' });
    await page.goto('/railcard-guide.html');                   // where the member came from
    await page.goto('/paycalc.html');
    await expect(page.locator('#noticeHppLightbox.visible')).toBeVisible();
    await page.locator('#noticeHppGo').click();
    await page.waitForURL(/\/paycalc\.html\?payday=2026-03-13#payslipCard$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/paycalc\.html$/);
    expect(await page.evaluate(() => history.state?.mybOverlay ?? null),
        'Back landed on the notice\'s own entry, whose next Back nothing answers').toBeNull();
    await page.goBack();
    await expect(page, 'one more Back leaves Pay').toHaveURL(/\/railcard-guide\.html$/);
    expect(errors).toHaveLength(0);
});

// ALREADY ON THAT PAYSLIP, THE LINK STILL LANDS (App Notices review, 24 Nov 2026). From the Calendar's pay jump the
// address is ?payday=2026-03-13 already, so the link differs by its #payslipCard alone: the browser does not reload,
// and the notice used to vanish leaving the card shut and a dead step in Back. Now it closes and opens the card here.
test('paycalc: the premium notice\'s link, already on that payslip, opens its card here and adds no step to Back', async ({ page }) => {
    test.setTimeout(60_000);
    const errors = collectFatalErrors(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await payMemberWithNoNoticeAnswered(page, HPP_NOTICE_DAY, HPP_MEMBER, { myb_pc_ytd_notice_2_shown: '1' });
    await page.goto('/railcard-guide.html');                   // where the member came from
    await page.goto('/paycalc.html?payday=2026-03-13');        // the Calendar's pay jump to that payday
    await expect(page.locator('#noticeHppLightbox.visible')).toBeVisible();
    await page.evaluate(() => { /** @type {any} */ (window).__samePage = true; });
    await page.locator('#noticeHppGo').click();
    await expect(page).toHaveURL(/\/paycalc\.html\?payday=2026-03-13#payslipCard$/);
    expect(await page.evaluate(() => /** @type {any} */ (window).__samePage), 'no reload: the same page').toBe(true);
    await expect(page.locator('.lb-overlay.visible')).toHaveCount(0);
    await expect(page.locator('#periodSelect')).toHaveValue('49');
    await expect(page.locator('#payslipCardBody')).toHaveClass(/open/);
    await expect(page.locator('#payslipCard')).toBeInViewport();
    expect(await hppFlag(page), 'its link answered it').toBe('1');
    await page.goBack();
    await expect(page, 'one Back leaves Pay: the notice left no step behind').toHaveURL(/\/railcard-guide\.html$/);
    expect(errors).toHaveLength(0);
});

// IT STILL COMES ONCE THE YEAR TO DATE NOTICE'S CODE IS GONE (App Notices review, 24 Nov 2026). It used to wait for that
// notice's flag alone, which only that notice's own code sets on a device that never saw it — so deleting that code at
// the monthly cleanup would leave every new phone waiting for ever. Served here WITHOUT that notice's expiry branch, as
// a device meets the page once the code is removed: past the Year to Date notice's end, with no flag, it still arrives.
test('paycalc: the premium notice still comes once the Year to Date notice\'s code is gone', async ({ page }) => {
    test.setTimeout(60_000);
    const errors = collectFatalErrors(page);
    const branch = "if (isNoticeExpired(NOTICE_DATE, YTD_NOTICE_DAYS) && !lsGet(NOTICE_YTD_KEY)) { lsSet(NOTICE_YTD_KEY, '1'); return noop; }";
    let removed = false;
    await page.route('**/paycalc-lightboxes.js', async route => {
        const res = await route.fetch();
        const body = await res.text();
        removed = body.includes(branch);
        await route.fulfill({ response: res, body: body.replace(branch, 'if (isNoticeExpired(NOTICE_DATE, YTD_NOTICE_DAYS)) return noop;') });
    });
    await payMemberWithNoNoticeAnswered(page, new Date('2026-11-27T09:00:00Z'));   // the Year to Date notice ended at 23:00 on 25 Nov
    await page.goto('/paycalc.html');
    await expect(page.locator('#noticeHppLightbox.visible')).toBeVisible();
    expect(removed, 'premise: the served file had the branch, and it was taken out').toBe(true);
    expect(await page.evaluate(() => localStorage.getItem('myb_pc_ytd_notice_2_shown')), 'nothing set the Year to Date flag').toBeNull();
    expect(errors).toHaveLength(0);
});

for (const { who, name, extra } of [
    // Their first pay period came after 2025/26 ended, so no 2025/26 premium is due them.
    { who: 'a joiner who started after 2025/26', name: HPP_JOINER, extra: {} },
    // Already estimated from Year to Date pay: the notice would ask for what is done.
    { who: 'a member who already has a figure of their own', name: HPP_MEMBER,
      // From the year's LAST payslip (p49, 13 Mar 2026): a rough figure from any earlier one covers only
      // part of the year, so it does not count as theirs and the notice still asks (review, 16 Nov 2026).
      extra: { myb_pc_gmiller_hpp_mode_2025_26: JSON.stringify({ mode: 'ytd', exact: '' }), myb_pc_gmiller_hpp_est_2025_26: '444.12',
               myb_pc_gmiller_ytd_src_2025_26: '49' } },
]) {
    test(`paycalc: the premium notice is not for ${who}, and is not answered for them (v26.22)`, async ({ page }) => {
        const errors = collectFatalErrors(page);
        await payMemberWithNoNoticeAnswered(page, HPP_NOTICE_DAY, name, { myb_pc_ytd_notice_2_shown: '1', ...extra });
        await page.goto('/paycalc.html');
        await expect(page.locator('#netDisplay')).toHaveText(/£\d/);
        await page.waitForTimeout(2000);
        await expect(page.locator('.lb-overlay.visible')).toHaveCount(0);
        // The flag is the DEVICE's: set for this member's answer, it would take the notice from the
        // next member signed in on this phone (the test below).
        expect(await hppFlag(page), 'kept shut, never flagged').toBeNull();
        expect(errors).toHaveLength(0);
    });
}

test('paycalc: on a shared phone, the premium notice a joiner cannot use still reaches the next member signed in (v26.22)', async ({ page }) => {
    test.setTimeout(60_000);
    const errors = collectFatalErrors(page);
    await payMemberWithNoNoticeAnswered(page, HPP_NOTICE_DAY, HPP_JOINER, { myb_pc_ytd_notice_2_shown: '1' });
    await page.goto('/paycalc.html');
    await expect(page.locator('#netDisplay')).toHaveText(/£\d/);
    await page.waitForTimeout(2000);
    await expect(page.locator('.lb-overlay.visible'), 'not for the joiner').toHaveCount(0);
    // The next member signs in on the same phone. Registered after the first script, this one runs
    // after it on every load: the session is theirs, and the rest of the device is as the joiner left it.
    await page.addInitScript(n => {
        localStorage.setItem('myb_admin_session', JSON.stringify({ name: n, ver: 2, expiry: Date.now() + 90 * 24 * 60 * 60 * 1000 }));
    }, HPP_MEMBER);
    await page.reload();
    await expect(page.locator('#noticeHppLightbox.visible'), 'still owed to the member it is for').toBeVisible();
    await expect(page.locator('.lb-overlay.visible'), 'and alone').toHaveCount(1);
    expect(errors).toHaveLength(0);
});

for (const { when, day, ytdAnswered, opens, flag } of [
    { when: 'the evening before it was posted', day: new Date('2026-11-15T21:00:00Z'), ytdAnswered: true,  opens: false, flag: null },
    // The Year to Date notice ended in November and flags itself unseen, so it holds nothing back.
    { when: 'its last day, 8 January',          day: new Date('2027-01-08T20:00:00Z'), ytdAnswered: false, opens: true,  flag: null },
    { when: 'the morning after its last day',   day: new Date('2027-01-09T09:00:00Z'), ytdAnswered: false, opens: false, flag: '1' },
]) {
    test(`paycalc: the premium notice on ${when} (v26.22)`, async ({ page }) => {
        const errors = collectFatalErrors(page);
        await payMemberWithNoNoticeAnswered(page, day, HPP_MEMBER, ytdAnswered ? { myb_pc_ytd_notice_2_shown: '1' } : {});
        await page.goto('/paycalc.html');
        await expect(page.locator('#netDisplay')).toHaveText(/£\d/);
        if (opens) {
            await expect(page.locator('#noticeHppLightbox.visible')).toBeVisible();
            await expect(page.locator('.lb-overlay.visible'), 'and alone').toHaveCount(1);
        } else {
            await page.waitForTimeout(2000);
            await expect(page.locator('.lb-overlay.visible')).toHaveCount(0);
            expect(await hppFlag(page)).toBe(flag);
        }
        expect(errors).toHaveLength(0);
    });
}

test('paycalc: the premium notice never opens over a card a link opened, and is not lost by it (v26.22)', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await payMemberWithNoNoticeAnswered(page, HPP_NOTICE_DAY, HPP_MEMBER, { myb_pc_ytd_notice_2_shown: '1' });
    await page.goto('/paycalc.html#payTransferCard');
    await expect(page.locator('#payTransferBody')).toHaveClass(/open/);
    await page.waitForTimeout(2000);
    await expect(page.locator('.lb-overlay.visible')).toHaveCount(0);
    expect(await hppFlag(page), 'held back, not answered').toBeNull();
    await page.goto('/paycalc.html');
    await expect(page.locator('#noticeHppLightbox.visible'), 'it comes on the next plain visit').toBeVisible();
    expect(errors).toHaveLength(0);
});

// FITS THE SMALLEST PHONES (polish, owner 16 Nov 2026). A notice card stops at 80% of the screen
// (`.notice-lb-content`, shared.css) and scrolls inside itself past that. As first written — three
// paragraphs and a 31-character button — this one did, on a 360x740 Android phone and on an iPhone SE
// (375x667, a 533px cap), and "Not now" sat under the card's fade; the button also broke onto a second
// line at 360, leaving its arrow alone. Two paragraphs and a short label fit both at 503px, like the
// notices beside it. Measured on the layout, not the picture: a card part-way through its opening
// animation is scaled, which a screenshot shows and scrollHeight does not.
for (const [w, h] of [[360, 740], [375, 667]]) {
    test(`paycalc: the premium notice fits a ${w}x${h} phone without scrolling, its button on one line (v26.22)`, async ({ page }) => {
        await page.setViewportSize({ width: w, height: h });
        await payMemberWithNoNoticeAnswered(page, HPP_NOTICE_DAY, HPP_MEMBER, { myb_pc_ytd_notice_2_shown: '1' });
        await page.goto('/paycalc.html');
        await expect(page.locator('#noticeHppLightbox.visible')).toBeVisible();
        const fit = await page.evaluate(() => {
            const card = /** @type {HTMLElement} */ (document.getElementById('noticeHppContent'));
            const go = /** @type {HTMLElement} */ (document.getElementById('noticeHppGo'));
            const range = document.createRange();
            range.selectNodeContents(go);
            const lines = new Set([...range.getClientRects()].map(r => Math.round(r.top))).size;
            return { need: card.scrollHeight, has: card.clientHeight, lines };
        });
        expect(fit.need, `the card needs ${fit.need}px and has ${fit.has}px: it would scroll, and "Not now" with it`)
            .toBeLessThanOrEqual(fit.has + 1);
        expect(fit.lines, 'the button keeps to one line').toBe(1);
    });
}

// A mid-year joiner (startDate this tax year) must NOT be told to fill in payslips from before
// they were employed. The HPP + back-pay period loops skip periods entirely before startDate
// (getProRateFactor(p) === 0), fixing the "Not entered yet: 10 Apr…" + inflated "N of 13" denom
// for a joiner (v18.54 — from the max-effort review). The joiner seeded below started 5 May 2026
// (a start date, from the public roster — no payslip of theirs is involved), so their 2026/27
// window's 10 Apr + 8 May payslips predate their employment.
test('paycalc: a joiner is not asked to fill in pre-employment payslips', async ({ page }) => {
    await page.clock.setFixedTime(PAY_2026_27_DAY);
    await page.setViewportSize({ width: 390, height: 844 });
    await seedSession(page, JOINER);   // getLoggedMember reads the session, not the calendar member
    const oneSat = JSON.stringify({ satH:8,satM:0,bhH:0,bhM:0,bhOtH:0,bhOtM:0,otH:0,otM:0,rdwH:0,rdwM:0,sunH:0,sunM:0,boxH:0,boxM:0,peer:0,slSkip:false,otherAdj:0,actualNet:null });
    await page.addInitScript(({ seed, pc }) => {
        localStorage.setItem('myb_pc_ns_migrated','1');
        localStorage.setItem(`${pc}grade`,'cea');
        localStorage.setItem(`${pc}setup`,'1');
        localStorage.setItem(`${pc}p52`, seed);   // p52 = 5 Jun 2026 — after the 5 May start
    }, { seed: oneSat, pc: JOINER_PC });
    await page.goto('/paycalc.html');
    // The page has calculated, waited for rather than slept past (test audit, 7 Nov 2026 — these
    // were 800ms and 400ms). The figure is written by the opening period's calculate(), and the two
    // lines below are then waited for by what they must SAY before anything is read as absent.
    await expect(page.locator('#netDisplay')).toHaveText(/£\d/);
    await page.evaluate(() => {
        for (const id of ['hppCardToggle','backPayCardToggle']) {
            const t = document.getElementById(id);
            /** @type {HTMLElement} */ (t.querySelector('.collapse-chevron') || t).click();
        }
    });
    const hppBasis = page.locator('#hppBasis');
    const bpNotice = page.locator('#backPayNotice');
    // Each line SAYS SOMETHING FIRST. The absence checks below used to be the only checks on the
    // back-pay notice, and an absence also holds for a notice that is empty or never written — so
    // every one of them would pass a page that had stopped telling the joiner anything at all.
    await expect(hppBasis, 'HPP denominator excludes the 2 pre-start periods').toContainText('of 11');
    await expect(bpNotice, 'back pay names the post-start payslips with no hours').toContainText('No hours are saved for 3 Jul, 31 Jul');
    // Pre-start payslips are neither named nor counted in the denominator.
    await expect(hppBasis, 'HPP must not name a pre-employment payslip').not.toContainText('10 Apr');
    await expect(hppBasis).not.toContainText('8 May');
    await expect(bpNotice, 'back pay must not name a pre-employment payslip').not.toContainText('10 Apr');
    await expect(bpNotice).not.toContainText('8 May');
});

// A mid-year joiner's rough "from Year to Date" HPP estimate must not subtract PRE-EMPLOYMENT
// non-premium pay. _expectedNonPremiumYtd now pro-rates London + pension by the joining factor
// (v18.55), so pre-start periods (factor 0) contribute £0 instead of a phantom "London − pension".
// A 5 May 2026 joiner has a fixed non-premium baseline ~£2924 vs a buggy ~£3179; a Taxable Pay of
// £3050 sits between them. Every figure here is COMPUTED by the calculator from the published
// rates and a public start date — none is read off anybody's payslip — buggy → £0, fixed → a real figure.
test('paycalc: joiner ytd-mode HPP excludes pre-employment non-premium pay', async ({ page }) => {
    await page.clock.setFixedTime(PAY_2026_27_DAY);   // the joining tax year — see the note above Fill-the-year
    await page.setViewportSize({ width: 390, height: 844 });
    await seedSession(page, JOINER);
    await page.addInitScript((pc) => {
        localStorage.setItem('myb_pc_ns_migrated','1');
        localStorage.setItem(`${pc}grade`,'cea');
        localStorage.setItem(`${pc}setup`,'1');
        localStorage.setItem(`${pc}ytd_src_2026_27`,'52');
    }, JOINER_PC);
    await page.goto('/paycalc.html');
    // Calculated, not slept past (test audit, 7 Nov 2026 — 700ms): the figure appears in the same
    // synchronous init that wires #ytdPay's listener, so a value typed from here is heard.
    await expect(page.locator('#netDisplay')).toHaveText(/£\d/);
    const ytdFigure = async () => parseFloat(
        ((await page.locator('#hppModeYtdAmt').textContent()) || '').replace(/[^0-9.]/g, '')) || 0;
    expect(await ytdFigure(), 'premise: no Year to Date figure, no estimate from it').toBe(0);
    // Opened first: a closed card's fields are out of reach (paycalc.css → `.collapsible-body`).
    await page.locator('#payslipCardToggle .card-toggle-arrow').click();
    await page.fill('#ytdPay','3050');
    await page.dispatchEvent('#ytdPay','input');
    // Polled, where this read once after a 400ms sleep: the estimate is drawn by the recalculation
    // the input starts, and a buggy page — one charging phantom pre-employment pay — never moves off 0.
    await expect.poll(ytdFigure, { message: 'joiner ytd HPP figure must be positive (not zeroed by phantom pre-employment pay)' })
        .toBeGreaterThan(0);
});

// The member's OWN Holiday Pay Premium figure is not labelled an estimate (polish round 2). The
// card read "ESTIMATED" over a number the member had just typed from their own records — and it has
// to keep saying "Estimated" for the two modes that ARE estimates, so all three are driven here.
test('paycalc: the HPP card calls your own figure yours, and an estimate an estimate', async ({ page }) => {
    await seedSession(page);
    await page.addInitScript(() => { localStorage.setItem('myb_pc_ns_migrated', '1'); });
    await page.goto('/paycalc.html');
    // A figure, not the element: the static page already has "£–", a ticked Hours and "Estimated",
    // so every check below passes before the page has started. Its start-up then restores the
    // card's saved choice, which un-ticks a choice clicked too early (seen once under load).
    await expect(page.locator('#netDisplay')).toHaveText(/£\d/);
    await page.locator('#hppCardToggle').click();
    const label = page.locator('#hppLabel');

    await expect(page.locator('#hppModeHours')).toBeChecked();
    await expect(label, 'the hours estimate is an estimate').toHaveText(/^Estimated/);

    await page.locator('#hppModeExact').check();
    await page.locator('#hppExactAmt').fill('320');
    await expect(label, "the member's own figure is not called an estimate").not.toHaveText(/estimat/i);
    await expect(label).toHaveText(/^Your /);
    await expect(page.locator('#hppAmount')).toHaveText('£320.00');

    await page.locator('#hppModeYtd').check();
    await expect(label, 'the Year to Date figure is still a rough estimate').toHaveText(/^Estimated/);
});
