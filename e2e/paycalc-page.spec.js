/**
 * paycalc-page.spec.js — the Pay Calculator (paycalc.html): the page itself — sign-in, the period
 * selector and picker, the privacy note and the desktop workspace.
 *
 * Split by feature out of paycalc.spec.js on 25 Nov 2026, test for test and unchanged; what more than
 * one paycalc-*.spec.js file needs is in paycalc-helpers.js, including the roster rows these tests sign
 * in as, which are chosen by shape and never written down (payroll-anonymity.test.mjs).
 */
import { test, expect } from './fixtures.js';
import { collectFatalErrors, seedSession, seedMemberSession, pickFirstMemberAndPassword, isTouchProject } from './helpers.js';
import { JOINER, PROMOTED, LONG_SERVING, openReturning } from './paycalc-helpers.js';

// ── THE REAL ROWS THESE TESTS SIGN IN AS ARE CHOSEN BY SHAPE, NEVER WRITTEN DOWN ────────────────
// A pay test prices a payslip for whoever it signs in as, and the GitHub Pages mirror serves this file,
// so a roster name here would sit beside that member's pay (payroll-anonymity.test.mjs). Each row is
// found by a property the test depends on, and its storage prefix is derived from it.

test('the rows these tests sign in as are on the roster', () => {
    expect(JOINER, 'premise: a CEA who started on Tue 5 May 2026').toBeTruthy();
    expect(PROMOTED, 'premise: a CEA promoted to CES on Sun 22 Nov 2026').toBeTruthy();
    expect(LONG_SERVING, 'premise: a CEA employed all of 2025/26').toBeTruthy();
});


test('paycalc: shows the in-place login when not signed in (no redirect)', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.goto('/paycalc.html');
    // Option B: paycalc no longer redirects to admin to sign in — the shared overlay is in place.
    await expect(page).toHaveURL(/paycalc\.html/);
    await expect(page.locator('#loginOverlay')).toBeVisible();
    expect(errors, 'Uncaught JS exceptions on paycalc login').toHaveLength(0);
});

test('paycalc (signed in): pay period selector is populated', async ({ page }) => {
    const errors = collectFatalErrors(page);

    // paycalc.html requires a session (per-member pay data); seed one so the page runs its
    // own init and builds the period <select> instead of showing the in-place login.
    await seedSession(page);
    await page.goto('/paycalc.html');

    // Proof we were NOT redirected — the guard let us through.
    await expect(page).toHaveURL(/paycalc\.html$/);

    // #periodSelect is in the static HTML but its <option>s are added by JS
    // from getPeriods(). toBeAttached() retries until an <option> is present in
    // the DOM — option elements have no bounding box so toBeVisible() is
    // unreliable. Once the first option is attached all options are there
    // (the function is synchronous).
    await expect(page.locator('#periodSelect option').first()).toBeAttached();
    const count = await page.locator('#periodSelect option').count();
    expect(count, '#periodSelect should have pay period options').toBeGreaterThan(10);

    expect(errors, 'Uncaught JS exceptions on paycalc.html').toHaveLength(0);
});

// THE PRIVACY LINE (v24.32, owner). One note at the foot of the page carries it on every visit; the
// card at the TOP shows only until this member has saved settings or any hours — it is for the
// first visit, just before somebody types in payslip figures. Three states, and the third is the
// one a shortcut would break: ANOTHER member's data on a shared phone must not count as yours.
for (const { name, seed, topVisible } of [
    { name: 'a first visit shows it at the top', seed: {}, topVisible: true },
    { name: 'saved settings hide the top copy', seed: { myb_pc_gmiller_setup: '1' }, topVisible: false },
    { name: 'saved hours hide the top copy', seed: { myb_pc_gmiller_p3: JSON.stringify({ basic: '140' }) }, topVisible: false },
    { name: "another member's data does not hide it", seed: { myb_pc_ssilva_setup: '1', myb_pc_ssilva_p3: '{}' }, topVisible: true },
]) {
    test(`paycalc privacy note: ${name}`, async ({ page }) => {
        const errors = collectFatalErrors(page);
        await seedSession(page);
        await page.addInitScript((kv) => {
            localStorage.setItem('myb_pc_ytd_notice_2_shown', '1');
            localStorage.setItem('myb_pc_ns_migrated', '1');
            for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v);
        }, seed);
        await page.goto('/paycalc.html');
        await expect(page.locator('#periodSelect option').first()).toBeAttached();
        const top = page.locator('#privacyNoteTop');
        if (topVisible) await expect(top).toBeVisible();
        else await expect(top).toBeHidden();
        // THE SETUP BANNER'S RESTORE LINE KEEPS THE SAME RULE (the iPhone audit, 7 Nov 2026): it
        // points an EMPTY calculator at Restore, so it shows exactly when the top note does. Its own
        // `hidden` is the rule's answer — read directly, because saved settings also confirm the
        // year and hide the whole banner, and a line inside a hidden banner is hidden whatever the
        // rule said. Where the rule says show, it must really be on screen.
        const restore = page.locator('#setupRestore');
        await expect(restore).toHaveJSProperty('hidden', !topVisible);
        if (topVisible) await expect(restore).toBeVisible();
        // The foot of the page says it on EVERY visit, whatever the top does — and says WHERE: in
        // this browser, because on an iPhone Safari and the Home Screen app keep separate copies.
        await expect(page.locator('.disclaimer .disclaimer-privacy')).toBeVisible();
        await expect(page.locator('.disclaimer .disclaimer-privacy')).toContainText('saved in this browser on this device');
        expect(errors).toHaveLength(0);
    });
}

// Desktop WORKSPACE layout (v16.67): Hours + Settings span the two wide work columns; a
// col-3 sidebar (.pc-side) stacks the result card and the four occasional cards, filling the
// column (the v16.14 lone-sticky-rail left a full-height navy void). Rendered-viewport
// assertions — a passing maths/unit suite never catches a broken grid. The two required
// review viewports (1366×768 laptop, 1440×900) plus the pre-existing 1280 guard.
for (const { w, h } of [{ w: 1024, h: 900 }, { w: 1280, h: 1000 }, { w: 1366, h: 768 }, { w: 1440, h: 900 }]) {
    test(`paycalc desktop workspace @${w}×${h}`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width: w, height: h });
        await seedSession(page);
        // Suppress the one-time notices so we measure the underlying layout.
        await page.addInitScript(() => {
            localStorage.setItem('myb_pc_ytd_notice_2_shown', '1');
            localStorage.setItem('myb_pc_ns_migrated', '1');
        });
        await page.goto('/paycalc.html');
        await expect(page.locator('#settingsCard')).toBeVisible();
        // The roster-assist hint loads asynchronously and changes the Hours card height;
        // let the layout settle so the measurement isn't a mid-render frame.
        await page.waitForTimeout(800);

        const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, 'no horizontal overflow on desktop').toBeLessThanOrEqual(1);

        // The result rail is the primary live output — on-screen at load.
        await expect(page.locator('.result-card')).toBeInViewport();

        // WORKSPACE (v16.67; result raised to the period-band row v16.71; to the top row in the laptop
        // polish, 13 Nov 2026): Hours + Settings span the two WIDE work columns (col 1–2); the col-3
        // SIDEBAR (.pc-side) holds the result card AND the four occasional cards, stacked in one
        // column to the right of the work cards. The sidebar shares the work column's row, so the
        // take-home result heads the top-right corner level with whatever heads the work column —
        // on this first visit, the welcome banner — and no navy void sits above it. NOT sticky.
        const zone = await page.evaluate(() => {
            const hh = document.getElementById('hoursCard').getBoundingClientRect();
            const ss = document.getElementById('settingsCard').getBoundingClientRect();
            const pc = /** @type {Element} */ ([...document.querySelector('.pc-work').children]
                .find(el => el.getClientRects().length)).getBoundingClientRect();
            const rr = document.querySelector('.result-card').getBoundingClientRect();
            const pp = document.getElementById('payslipCard').getBoundingClientRect();
            const bp = document.getElementById('backPayCard').getBoundingClientRect();
            return {
                sidebarRightOfHours: rr.left > hh.right - 2 && pp.left > hh.right - 2,
                // The result tops the right column: level with the first block of the work column
                // and strictly ABOVE the Hours card — no navy void sits above it.
                resultTopsColumn: Math.abs(pc.top - rr.top) < 2 && rr.top < hh.top - 10,
                // Settings spans the two work columns → wider than a single col-3 sidebar card.
                // (~1.45× at the tight 1024 end, more at wider viewports.)
                settingsWide: ss.width > pp.width * 1.2,
                // The occasional cards STACK under the result in col 3: same left edge as the
                // result, and Back-Pay is BELOW Improve-Accuracy (a column, not a 2-up row).
                stacked: Math.abs(rr.left - pp.left) < 2 && Math.abs(pp.left - bp.left) < 2 && bp.top > pp.top + 10,
                resultNotSticky: getComputedStyle(document.querySelector('.result-card')).position !== 'sticky',
            };
        });
        expect(zone.sidebarRightOfHours, 'the col-3 sidebar is right of the work cards').toBe(true);
        expect(zone.resultTopsColumn, 'result tops column 3, level with the first block of the work column and above Hours').toBe(true);
        expect(zone.settingsWide, 'Settings spans the wide work columns').toBe(true);
        expect(zone.stacked, 'the occasional cards stack under the result in column 3').toBe(true);
        expect(zone.resultNotSticky, 'result is static in the sidebar (no longer a sticky rail)').toBe(true);

        // "Save settings" matches the fields it sits under (polish round 2). Under a tablet-up 280px
        // cap on `.btn-primary` (removed since: nothing it reached was meant to be capped) it ended
        // 368px short of the Tax code field above it at 1280, which read as a leftover, not a hierarchy.
        const saveFit = await page.evaluate(() => {
            const b = document.getElementById('saveSettingsBtn').getBoundingClientRect();
            const f = document.getElementById('taxCode').getBoundingClientRect();
            return { left: Math.round(b.left - f.left), width: Math.round(b.width - f.width) };
        });
        expect(saveFit, 'Save settings shares the Settings fields\' left edge and width').toEqual({ left: 0, width: 0 });

        // COLUMN SAFETY: the col-3 sidebar must not HORIZONTALLY overlap the two WORK cards
        // (Hours/Settings) — it is its own column. Scroll to the bottom sidebar card first.
        // Geometric, so it's robust at the tight 1024 end too.
        await page.getByText('Decimal Hours Converter').scrollIntoViewIfNeeded();
        await page.waitForTimeout(200);
        const overlapPx = await page.evaluate(() => {
            const side = document.querySelector('.pc-side').getBoundingClientRect();
            return Math.max(...['hoursCard', 'settingsCard'].map(id => {
                const c = document.getElementById(id).getBoundingClientRect();
                return c.right - side.left;   // >0 means a work card extends past the sidebar's left edge = overlap
            }));
        });
        expect(overlapPx, 'the sidebar must not horizontally overlap the work columns').toBeLessThanOrEqual(1);

        await page.screenshot({ path: testInfo.outputPath(`paycalc-${w}x${h}.png`), fullPage: true });
    });
}

// A payday the calculator does not carry used to open the current payslip silently (whole-app review).
test('paycalc: a link to a payday outside the calculator says so, and a covered one says nothing', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-22T09:00:00Z'));
    await seedSession(page);
    await page.addInitScript(() => { localStorage.setItem('myb_pc_ns_migrated', '1'); });
    await page.goto('/paycalc.html?payday=2027-04-09');
    const note = page.locator('#periodLinkNote');
    await expect(note).toBeVisible();
    await expect(note).toContainText("There's no payslip for 9 April 2027 in the calculator");
    await page.goto('/paycalc.html?month=2027-06');
    await expect(note).toContainText("There's no payslip for June 2027 in the calculator");
    await page.goto('/paycalc.html?payday=2026-10-23');
    await expect(page.locator('#pensionAmt')).toBeVisible();
    await expect(note).toBeHidden();
});

// The 31 Jul 2026 payslip prints its pension as TWO "Smart RPS CR Scheme" lines, £113.90 + £36.84:
// the 2026/27 rise began three weeks into that period (payslips re-read 10 Nov 2026). The field opens
// on their total — the table said £147.36, so that payslip's estimate was £3.38 out on pension alone.
test('paycalc: each payslip around the 2026/27 pension rise opens on the pension printed on it', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-11-10T09:00:00Z'));
    await seedSession(page);
    await page.addInitScript(() => { localStorage.setItem('myb_pc_ns_migrated', '1'); });
    for (const [payday, printed] of [['2026-07-03', '147.36'], ['2026-07-31', '150.74'], ['2026-08-28', '151.86']]) {
        await page.goto(`/paycalc.html?payday=${payday}`);
        await expect(page.locator('#pensionAmt'), `the ${payday} payslip`).toHaveValue(printed);
    }
});

// From 768px the Earlier and Later buttons share the select's row, and centred beside it they were 36px
// to its 44 (laptop polish, 13 Nov 2026). They take the row's height now, so the three read as one row.
test('paycalc: from 768px the period buttons are as tall as the select beside them', async ({ page }, info) => {
    test.skip(isTouchProject(info), 'a desktop window');
    await seedMemberSession(page, 'G. Miller');
    for (const width of [800, 1280]) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto('/paycalc.html');
        await expect(page.locator('#prevBtn')).toBeVisible();
        const h = await page.evaluate(() => {
            const tall = (/** @type {string} */ s) => { const e = /** @type {HTMLElement|null} */ (document.querySelector(s));
                return e && e.offsetParent ? Math.round(e.getBoundingClientRect().height) : null; };
            return { select: tall('#periodSelectTrigger') ?? tall('#periodSelect'), earlier: tall('#prevBtn'), later: tall('#nextBtn') };
        });
        expect(h.select, `premise: the select is drawn at ${width}px`).toBeGreaterThanOrEqual(44);
        expect([h.earlier, h.later], `${width}px: Earlier and Later against the select's ${h.select}px`).toEqual([h.select, h.select]);
    }
});

// THE SIGN-IN CARD EXPLAINS THE PAGE (v25.50). A visitor with no named session — a member whose
// session lapsed, or somebody who has not signed in here yet — met a bare "Pay Calculator · Sign in"
// with nothing to say what it was or who it was for. (Until the staff PIN was retired, 23 Nov 2026, it
// also said the PIN does not open it; that half went with the PIN.)
test('paycalc: the sign-in card says what the calculator is, who it is for, and why you sign in as yourself', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.goto('/paycalc.html');
    const about = page.locator('#loginAbout');
    await expect(about).toBeVisible();
    await expect(about).toContainText('Customer Experience Ambassadors and Supervisors (CEA and CES)');
    await expect(about).toContainText('under your own name, so you sign in as yourself.');
    await expect(about).not.toContainText('PIN');
    await expect(about.locator('a.login-about-link')).toHaveAttribute('href', './paycalc-guide.html');
    await expect(page.locator('#loginFootnote')).toContainText('shared screen');
    // The words DESCRIBE the dialog, so a screen reader announces them with the card.
    await expect(page.locator('#loginOverlay')).toHaveAttribute('aria-describedby', 'loginAbout');
    // The explanation sits ABOVE the form, so it is read before the fields it explains.
    const [aboutBox, fieldBox] = await Promise.all([about.boundingBox(), page.locator('#loginCard .login-field').first().boundingBox()]);
    expect(aboutBox && fieldBox && aboutBox.y + aboutBox.height <= fieldBox.y, 'the explanation is above the first field').toBe(true);
    expect(errors, 'Uncaught JS exceptions on the explained sign-in card').toHaveLength(0);
});

// ...and only on this page: another page's card carries its OWN explanation (owner, 21 Nov 2026 — every
// page's card says what the page is; e2e/auth.spec.js holds them all), never the Pay Calculator's words
// or its guide link.
test('the sign-in explanation is the Pay Calculator\'s alone — another page\'s card is its own', async ({ page }) => {
    await page.goto('/settings.html');
    await expect(page.locator('#loginOverlay')).toBeVisible();
    await expect(page.locator('#loginAbout')).toBeVisible();
    await expect(page.locator('#loginAbout')).not.toContainText(/take-home pay/i);
    await expect(page.locator('#loginAbout .login-about-link')).toHaveCount(0);
});

// The guide link is a second way OFF the sign-in card, so it keeps the Back link's rule: a sign-in in
// flight cannot be abandoned through it (the half signed-in state, v14.75). Read as the click's own
// answer, as the Back link's test does — `dispatchEvent` returns after every listener has run.
test('paycalc: the sign-in card\'s guide link is inert while a sign-in is in flight', async ({ page }) => {
    await page.addInitScript(() => { /** @type {any} */ (window).__E2E = { hangSignIn: true }; });
    await page.goto('/paycalc.html');
    const link = page.locator('#loginAbout a.login-about-link');
    await expect(link).toBeVisible();
    await expect(link).not.toHaveAttribute('aria-disabled', 'true');

    const { pw } = await pickFirstMemberAndPassword(page);
    await page.locator('#loginPassword').fill(pw);
    await page.locator('#loginSubmit').click();
    await expect(page.locator('#loginSubmit')).toHaveText('Signing in…');

    await expect(link).toHaveAttribute('aria-disabled', 'true');
    const cancelled = await link.evaluate(el =>
        !el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true })));
    expect(cancelled, 'the guide link must cancel its own navigation during an in-flight sign-in').toBe(true);
    await expect(page).toHaveURL(/paycalc\.html/);
});

// ── THE PERIOD PICKER NAMES THE PERIOD THE PAGE IS COMPUTING (v23.42) ────────────────────────────
// From v23.36 the closed control a member reads is the ENHANCED TRIGGER, not the `<select>`. The
// select is 1px and `aria-hidden`, so its own `selectedOptions` is invisible to everybody — which
// is why this asserts the trigger's FACE and not the select's value.
//
// The three navigation paths all move the period through `_setSelectPeriod`, which sets
// `option.selected` — a change that mutates no attribute and fires no event, so nothing repainted
// the face. Measured before the fix: ←, →→ and a tax-year jump each left "● Paid 25 Sept 2026 ·
// P28" standing over a page computing 28 Aug 2026, 23 Oct 2026 and then 11 Apr **2025** — a take-
// home figure under a label naming the wrong tax year, with nothing on screen to say so.
//
// The tax-year jump is the case worth keeping even if the other two are ever refactored away: it
// is the only one that crosses a year, and the year is what makes a wrong label expensive rather
// than merely untidy.
test('paycalc: the period picker names the period the page is computing', async ({ page }) => {
    const errors = collectFatalErrors(page);
    // A payslip with one either side of it (test audit, 7 Nov 2026). On the real clock, once today's
    // payslip is the last one the calculator holds (from mid-February 2027, until 2027/28 is added to
    // TAX_YEARS), the second → is disabled and the click waits out the test's whole timeout.
    await page.clock.setFixedTime(new Date('2026-10-21T09:00:00Z'));
    await seedSession(page);
    await page.addInitScript(() => {
        localStorage.setItem('myb_pc_ytd_notice_2_shown', '1');
        localStorage.setItem('myb_pc_ns_migrated', '1');
    });
    await page.goto('/paycalc.html');
    await expect(page.locator('#settingsCard')).toBeVisible();

    // The face and the select must agree at every step. Read both in one evaluate so a re-render
    // between two locator reads cannot produce a false pass.
    const agree = async (what) => {
        const { label, face } = await page.evaluate(() => {
            const sel = /** @type {HTMLSelectElement} */ (document.getElementById('periodSelect'));
            return {
                label: sel.selectedOptions[0]?.textContent?.trim() ?? '',
                face: document.querySelector('#periodSelectTrigger .fieldpick-face')?.textContent?.trim() ?? '',
            };
        });
        expect(label, `${what}: the select should hold a period`).not.toBe('');
        expect(face, `${what}: the picker face must name the selected period`).toBe(label);
        return label;
    };

    const start = await agree('on load');

    await page.locator('#prevBtn').click();
    const prev = await agree('after ←');
    expect(prev, '← should have moved the period').not.toBe(start);

    await page.locator('#nextBtn').click();
    await page.locator('#nextBtn').click();
    const next = await agree('after → →');
    expect(next, '→ → should have moved the period').not.toBe(prev);

    // Crossing a tax year — the expensive case.
    await page.locator('.ty-tabs button').first().click();
    const jumped = await agree('after a tax-year jump');
    expect(jumped, 'the tax-year jump should have moved the period').not.toBe(next);

    expect(errors, 'Uncaught JS exceptions').toHaveLength(0);
});

// PAY8 — the period sheet opened at April 2025 with the payslip on screen ~17 rows down, out of view.
test('paycalc: the pay-period picker opens on the payslip on screen', async ({ page }) => {
    await openReturning(page);
    await page.locator('#periodSelectTrigger').click();
    const current = page.locator('.picker-sheet .picker-opt.is-current');
    await expect(current).toHaveCount(1);
    await expect.poll(() => current.evaluate(el => {
        const panel = /** @type {HTMLElement} */ (el.closest('.picker-sheet')).getBoundingClientRect();
        const search = /** @type {HTMLElement} */ (document.querySelector('.picker-sheet .picker-search')).getBoundingClientRect();
        const r = el.getBoundingClientRect();
        return r.top >= search.bottom - 1 && r.bottom <= panel.bottom + 1;
    }), { message: 'the current payslip is in view below the search box' }).toBe(true);
    expect(await page.locator('.picker-sheet').evaluate(el => el.scrollTop), 'the sheet scrolled to it').toBeGreaterThan(0);
    // …and the scroll that brought the payslip up did not take the sheet's title and ✕ away with it:
    // they are one sticky block with the search box (shared.css → `.picker-top`).
    const inPanel = await page.locator('.picker-sheet').evaluate(panel => {
        const box = panel.getBoundingClientRect();
        const shown = (/** @type {string} */ sel) => { const r = /** @type {Element} */ (panel.querySelector(sel)).getBoundingClientRect();
            return r.top >= box.top - 1 && r.bottom <= box.bottom + 1; };
        return { title: shown('.picker-head b'), close: shown('.lb-close') };
    });
    expect(inPanel, 'the title and the ✕ are still on screen').toEqual({ title: true, close: true });
});

// shared-ui-5 — a search box is named by what its list holds. The payslip pickers' titles are
// questions, which have no noun to weld onto "Search", so each box was called a bare "Search".
test('paycalc: every payslip picker calls its search box "Search pay periods"', async ({ page }) => {
    await openReturning(page);
    for (const id of ['periodSelect', 'pensionOptOutFrom', 'slPaidOffFrom']) {
        // Two of these sit in Settings rows shown only once they apply, so the trigger is pressed
        // through the DOM: what is under test is the sheet the trigger opens, not the row around it.
        await page.locator(`#${id}Trigger`).evaluate(el => /** @type {HTMLElement} */ (el).click());
        const box = page.locator('.picker-sheet .picker-search-input');
        await expect(box, `${id}: a list of payslips earns a search box`).toBeVisible();
        await expect(box, id).toHaveAttribute('aria-label', 'Search pay periods');
        await page.keyboard.press('Escape');
        await expect(page.locator('.picker-sheet-overlay')).toBeHidden();
    }
});
