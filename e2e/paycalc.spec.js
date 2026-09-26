import { test, expect, enforceNamedSession } from './fixtures.js';
import { collectFatalErrors, seedSession, seedMember, pickFirstMemberAndPassword, DESKTOP_WIDTHS, armEnforcementWithFailingSignIn, signInThroughOverlay, clickInView } from './helpers.js';
// The REAL pay tables, imported rather than restated: the unsupported-role block below asserts that
// a CES is priced as a CES, and a literal rate there would go stale on the next award — or, worse,
// be "corrected" to whatever the page happened to show.
import { GRADES, AWARD_RATES, TAX_YEARS } from '../paycalc-calc.js';


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
        // The foot of the page says it on EVERY visit, whatever the top does.
        await expect(page.locator('.disclaimer .disclaimer-privacy')).toBeVisible();
        await expect(page.locator('.disclaimer .disclaimer-privacy')).toContainText('saved on this device only');
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

        // WORKSPACE (v16.67; result raised to the period-band row v16.71): Hours + Settings span
        // the two WIDE work columns (col 1–2); the col-3 SIDEBAR (.pc-side) holds the result card
        // AND the four occasional cards, stacked in one column to the right of the work cards. The
        // sidebar now starts at row 3 (level with the period band) so the take-home result heads
        // the top-right corner instead of leaving a navy void above it. The result is NOT sticky.
        const zone = await page.evaluate(() => {
            const hh = document.getElementById('hoursCard').getBoundingClientRect();
            const ss = document.getElementById('settingsCard').getBoundingClientRect();
            const pc = document.querySelector('.period-controls').getBoundingClientRect();
            const rr = document.querySelector('.result-card').getBoundingClientRect();
            const pp = document.getElementById('payslipCard').getBoundingClientRect();
            const bp = document.getElementById('backPayCard').getBoundingClientRect();
            return {
                sidebarRightOfHours: rr.left > hh.right - 2 && pp.left > hh.right - 2,
                // The result now tops the right column: level with the period band (not the Hours
                // card below it) and strictly ABOVE the Hours card — no navy void sits above it.
                resultTopsColumn: Math.abs(pc.top - rr.top) < 40 && rr.top < hh.top - 10,
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
        expect(zone.resultTopsColumn, 'result tops column 3, level with the period band and above Hours').toBe(true);
        expect(zone.settingsWide, 'Settings spans the wide work columns').toBe(true);
        expect(zone.stacked, 'the occasional cards stack under the result in column 3').toBe(true);
        expect(zone.resultNotSticky, 'result is static in the sidebar (no longer a sticky rail)').toBe(true);

        // "Save settings" matches the fields it sits under (polish round 2). The tablet-up 280px
        // cap on `.btn-primary` is about buttons with nothing above them; this one ended 368px short
        // of the Tax code field above it at 1280, which read as a leftover rather than a hierarchy.
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

// The data-ownership prompt is the paycalc overlay with the highest stakes — it decides whether
// another member's pay data on a shared device is claimed or discarded — so it must actually open,
// and it must be the ONLY thing open (overlay.js manages a single active overlay; two at once fight
// over Back/Escape/Tab).
//
// This is a STACKING test again (v21.91). It stopped being one twice over — the welcome lightbox was
// retired at v19.36, and the YTD notice went past its expiry on 5 Jul, leaving nothing on the page to
// stack WITH; the comment here recorded that loss as real and deliberate rather than pretending the
// assertion still meant something. Re-posting the YTD notice restores the competitor, so the
// priority rule is exercised from the outside once more. Note what that means: the value of the
// `toHaveCount(1)` assertion below has been silently zero for seven weeks, and only the note saying
// so made that recoverable.
// ── Estimate vs payslip (v22.07) ──────────────────────────────────────────────────────────────
// The builder and the round trip are unit-tested; a browser proves the WIRING — the disclosure,
// the table appearing as figures are typed, and saved figures surviving a reload INTO AN OPEN
// section (restored values hidden behind a closed disclosure was the designed-against failure).

test('paycalc: the payslip comparison renders per typed line and survives a reload', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await seedSession(page);
    await page.addInitScript(() => { localStorage.setItem('myb_pc_ytd_notice_2_shown', '1'); });
    await page.goto('/paycalc.html');
    await expect(page.locator('#periodSelect option').first()).toBeAttached();
    // A PAID period — the check block only renders for one. P2's payday is long past.
    await page.locator('#periodSelect').selectOption({ index: 1 });
    await expect(page.locator('#checkActualWrap')).toBeVisible();

    await clickInView(page.locator('#actualMoreBtn'));
    await expect(page.locator('#actualMoreWrap')).toBeVisible();
    await page.locator('#actualGrossInput').fill('3808.87');
    await page.locator('#actualTaxInput').fill('540.20');
    const table = page.locator('#actualCompare table.actual-cmp');
    await expect(table).toBeVisible();
    await expect(table).toContainText('Total pay');
    await expect(table).toContainText('Income Tax');
    await expect(table).toContainText('£3,808.87');
    // Only the typed lines render — an absent figure is not a £0 claim.
    await expect(table).not.toContainText('National Insurance');

    // Reload: the figures persisted into the period blob, and the section restored OPEN.
    await page.reload();
    await expect(page.locator('#periodSelect option').first()).toBeAttached();
    await page.locator('#periodSelect').selectOption({ index: 1 });
    await expect(page.locator('#actualMoreWrap')).toBeVisible();
    await expect(page.locator('#actualGrossInput')).toHaveValue('3808.87');
    await expect(page.locator('#actualCompare table.actual-cmp')).toBeVisible();

    expect(errors, `fatal errors: ${errors.join(', ')}`).toHaveLength(0);
});

// ── Fill this tax year from Calendar (v22.06) ─────────────────────────────────────────────────
// The rules are unit-tested (paycalc-fill-year.test.mjs); only a browser can prove the WIRING —
// that the button the "Not entered yet" line offers runs the real engine against the real
// storage, that the receipt lands, and that a period the member ENTERED survives the bulk write.

test('paycalc: Fill-the-year fills the empty paid periods, receipts by date, and spares entered data', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await seedSession(page);
    // One period the member typed by hand — the untouchable one. P2's payday (8 May 2026) is
    // long paid; 7h of Saturday is unmistakably hand-shaped data.
    await page.addInitScript(() => {
        // 'G. Miller' → memberSlug 'gmiller'; the trailing _ is pcPrefix's namespace separator.
        localStorage.setItem('myb_pc_ytd_notice_2_shown', '1');   // its lightbox would cover the button
        localStorage.setItem('myb_pc_gmiller_p2', JSON.stringify({
            satH: 7, satM: 0, bhH: 0, bhM: 0, bhOtH: 0, bhOtM: 0, otH: 0, otM: 0,
            rdwH: 0, rdwM: 0, sunH: 0, sunM: 0, boxH: 0, boxM: 0, peer: 0,
            slSkip: false, otherAdj: 0, actualNet: null,
        }));
    });
    await page.goto('/paycalc.html');
    await expect(page.locator('#periodSelect option').first()).toBeAttached();

    // The year block is in its slim or full state, naming what the button fixes.
    const block = page.locator('#ytdYearSoFar');
    // VISIBLE, not merely present (v22.08): this block used to live inside the YTD card's
    // collapsed body, where toContainText passed and clickInView clicked — against a control no
    // human could see. The assertion class this test now belongs to is "a member can do this".
    await expect(block).toBeVisible();
    await expect(block).toContainText('Not entered yet');
    await expect(page.locator('#fillYearBtn')).toBeVisible();
    await clickInView(page.locator('#fillYearBtn'));

    // The receipt: filled payslips BY DATE, plus the review-before-relying line.
    await expect(block.locator('.yearso-receipt')).toContainText(/Filled \d+ payslips? from your calendar/);
    await expect(block.locator('.yearso-receipt')).toContainText('Review the suggested hours');

    // The entered period survived byte-for-byte — rule 1, proven against real storage.
    const p2 = await page.evaluate(() => JSON.parse(localStorage.getItem('myb_pc_gmiller_p2') || 'null'));
    expect(p2.satH).toBe(7);
    // …and at least one previously-empty paid period now holds data plus its gold snapshot.
    const filled = await page.evaluate(() => {
        const out = [];
        for (const k of Object.keys(localStorage)) {
            if (/^myb_pc_gmiller_p\d+$/.test(k) && k !== 'myb_pc_gmiller_p2') out.push(k);
        }
        return out.map(k => ({ k, snap: !!localStorage.getItem(k.replace(/_p(\d+)$/, '_snap_$1')) }));
    });
    expect(filled.length).toBeGreaterThan(0);
    expect(filled.every(f => f.snap), 'every bulk fill must carry its roster-suggested snapshot').toBe(true);

    expect(errors, `fatal errors: ${errors.join(', ')}`).toHaveLength(0);
});

test('paycalc: the data-ownership prompt opens for legacy data, and alone', async ({ page }) => {
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


// A mid-year joiner (startDate this tax year) must NOT be told to fill in payslips from before
// they were employed. The HPP + back-pay period loops skip periods entirely before startDate
// (getProRateFactor(p) === 0), fixing the "Not entered yet: 10 Apr…" + inflated "N of 13" denom
// for a joiner (v18.54 — from the max-effort review). The joiner seeded below started 5 May 2026
// (a start date, from the public roster — no payslip of theirs is involved), so their 2026/27
// window's 10 Apr + 8 May payslips predate their employment.
test('paycalc: a joiner is not asked to fill in pre-employment payslips', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedSession(page, 'J. Davies');   // getLoggedMember reads the session, not the calendar member
    const oneSat = JSON.stringify({ satH:8,satM:0,bhH:0,bhM:0,bhOtH:0,bhOtM:0,otH:0,otM:0,rdwH:0,rdwM:0,sunH:0,sunM:0,boxH:0,boxM:0,peer:0,slSkip:false,otherAdj:0,actualNet:null });
    await page.addInitScript((seed) => {
        localStorage.setItem('myb_pc_ns_migrated','1');
        localStorage.setItem('myb_pc_jdavies_grade','cea');
        localStorage.setItem('myb_pc_jdavies_setup','1');
        localStorage.setItem('myb_pc_jdavies_p52', seed);   // p52 = 5 Jun 2026 — after her 5 May start
    }, oneSat);
    await page.goto('/paycalc.html');
    await page.waitForSelector('#netDisplay');
    await page.waitForTimeout(800);
    await page.evaluate(() => {
        for (const id of ['hppCardToggle','backPayCardToggle']) {
            const t = document.getElementById(id);
            /** @type {HTMLElement} */ (t.querySelector('.collapse-chevron') || t).click();
        }
    });
    await page.waitForTimeout(400);
    const { hppBasis, bpNotice } = await page.evaluate(() => ({
        hppBasis: document.getElementById('hppBasis')?.textContent.trim() || '',
        bpNotice: document.getElementById('backPayNotice')?.textContent.trim() || '',
    }));
    // Pre-start payslips are neither named nor counted in the denominator.
    expect(hppBasis, 'HPP must not name a pre-employment payslip').not.toContain('10 Apr');
    expect(hppBasis).not.toContain('8 May');
    expect(hppBasis, 'HPP denominator excludes the 2 pre-start periods').toContain('of 11');
    expect(bpNotice, 'back pay must not name a pre-employment payslip').not.toContain('10 Apr');
    expect(bpNotice).not.toContain('8 May');
});

// A mid-year joiner's rough "from Year to Date" HPP estimate must not subtract PRE-EMPLOYMENT
// non-premium pay. _expectedNonPremiumYtd now pro-rates London + pension by the joining factor
// (v18.55), so pre-start periods (factor 0) contribute £0 instead of a phantom "London − pension".
// A 5 May 2026 joiner has a fixed non-premium baseline ~£2924 vs a buggy ~£3179; a Taxable Pay of
// £3050 sits between them. Every figure here is COMPUTED by the calculator from the published
// rates and a public start date — none is read off anybody's payslip — buggy → £0, fixed → a real figure.
test('paycalc: joiner ytd-mode HPP excludes pre-employment non-premium pay', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedSession(page, 'J. Davies');
    await page.addInitScript(() => {
        localStorage.setItem('myb_pc_ns_migrated','1');
        localStorage.setItem('myb_pc_jdavies_grade','cea');
        localStorage.setItem('myb_pc_jdavies_setup','1');
        localStorage.setItem('myb_pc_jdavies_ytd_src_2026_27','52');
    });
    await page.goto('/paycalc.html');
    await page.waitForSelector('#netDisplay');
    await page.waitForTimeout(700);
    await page.fill('#ytdPay','3050');
    await page.dispatchEvent('#ytdPay','input');
    await page.waitForTimeout(400);
    const ytdAmt = await page.evaluate(() => document.getElementById('hppModeYtdAmt')?.textContent.trim() || '');
    const num = parseFloat(ytdAmt.replace(/[^0-9.]/g,'')) || 0;
    expect(num, 'joiner ytd HPP figure must be positive (not zeroed by phantom pre-employment pay)').toBeGreaterThan(0);
});

// The member's OWN Holiday Pay Premium figure is not labelled an estimate (polish round 2). The
// card read "ESTIMATED" over a number the member had just typed from their own records — and it has
// to keep saying "Estimated" for the two modes that ARE estimates, so all three are driven here.
test('paycalc: the HPP card calls your own figure yours, and an estimate an estimate', async ({ page }) => {
    await seedSession(page);
    await page.addInitScript(() => { localStorage.setItem('myb_pc_ns_migrated', '1'); });
    await page.goto('/paycalc.html');
    await page.waitForSelector('#netDisplay');
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

// ── Back up your pay data (v19.16) ────────────────────────────────────────────
// A restore REPLACES a member's entire pay history, and the rules that decide whether to do it are
// unit-tested in paycalc-transfer.test.mjs. What no unit test can prove is the WIRING — that the
// paste box reaches the ladder, that the confirmation actually gates the write, and that the data
// survives the reload. That gap is exactly the one the v19.13 tips crash fell through (a static
// suite passed; a human pressing the button found it), so the destructive path gets a real browser.
const PT_QUIET = () => {
    localStorage.setItem('myb_pc_ns_migrated', '1');
    localStorage.setItem('myb_pc_ytd_notice_2_shown', '1');
};

test('paycalc: the Settings deep link lands on the backup card OPEN', async ({ page }) => {
    // A bare fragment jump would scroll to a collapsed header, which reads as a dead link.
    // The viewport is pinned to a phone DELIBERATELY: the landing-position assertion below only
    // reproduces the drift on a single-column layout. On desktop the card sits in the col-3 sidebar
    // and never moves, so the project's default viewport made this test pass either way.
    await page.setViewportSize({ width: 390, height: 844 });
    await seedSession(page);
    await page.addInitScript(PT_QUIET);
    await page.goto('/paycalc.html#payTransferCard');
    await expect(page.locator('#payTransferBody')).toHaveClass(/open/);
    await expect(page.locator('#ptSummary')).not.toBeEmpty();

    // Landing POSITION, not just state. One scrollIntoView is not enough — the calculator keeps
    // laying out afterwards and the card drifts back down (measured at y=681 of an 844px viewport,
    // with 605px of scroll still available, i.e. the page had not bottomed out). Anything below
    // roughly a third of the viewport means the correction has regressed.
    await page.waitForTimeout(900);
    // VISIBLE before positioned (Sep 2026). A hidden card has no box, and `box.y` on null failed this
    // test with a TypeError — a failure by accident, which protects by accident. Measured in a
    // throwaway prototype that hid the card behind a disclosure control: the body still gained
    // `.open`, every scroll correction ran as a no-op against `display: none`, and the member landed
    // at the top of the page with nothing to explain why. This line makes that regression fail as
    // what it is. (The prototype was not adopted — ROADMAP.md, "More pay tools" — but the weakness
    // it found in this test was real.)
    const card = page.locator('#payTransferCard');
    await expect(card, 'the backup card must be visible before its landing position means anything').toBeVisible();
    const box = await card.boundingBox();
    const vh = page.viewportSize().height;
    expect(box.y, `card landed at y=${Math.round(box.y)} of ${vh}`).toBeLessThan(vh / 3);
});

test('paycalc: a long confirm dialog keeps its own buttons on screen', async ({ page }) => {
    // A SHARED-OVERLAY rule, exercised here because this is where a genuinely long message occurs.
    // `.dialog-lb-content` had no height cap while every message was two lines; the restore
    // confirmation now itemises both sides of a replace, and measured at 360x640 with a full
    // namespace it reached 616px of 640 — one more tax year from putting Cancel and Replace off
    // the bottom with no way to scroll to them. A modal nobody can dismiss is the worst failure a
    // modal has. No static test can see this: it is a rendered height against a viewport.
    await page.setViewportSize({ width: 360, height: 640 });
    await seedSession(page, 'G. Miller');
    await page.addInitScript(PT_QUIET);
    await page.addInitScript(() => {
        localStorage.setItem('myb_pc_gmiller_p16', '{"satH":7}');
        localStorage.setItem('myb_pc_gmiller_bp_state_2025_26', '{}');
        localStorage.setItem('myb_pc_gmiller_pension_timeline', '[]');
        localStorage.setItem('myb_pc_gmiller_actuals', '{}');
        localStorage.setItem('myb_pc_gmiller_snap_16', '{}');
    });
    await page.goto('/paycalc.html#payTransferCard');
    await expect(page.locator('#payTransferBody')).toHaveClass(/open/);

    // A deliberately maximal backup: many payslips, four tax years, and damage to report.
    await page.locator('#ptPaste').fill(JSON.stringify({
        format: 'myb-paycalc-backup', version: 1, member: 'G. Miller', slug: 'gmiller',
        data: Object.fromEntries([
            ...Array.from({ length: 13 }, (_, i) => [`myb_pc_gmiller_p${20 + i}`, '{"satH":1']),
            ['myb_pc_gmiller_setup_2022_23', '1'], ['myb_pc_gmiller_bp_state_2023_24', '{}'],
            ['myb_pc_gmiller_ytd_src_2024_25', '5'], ['myb_pc_gmiller_hpp_actual_2026_27', '1'],
        ]),
    }));
    await page.locator('#ptPasteGo').click();
    const confirm = page.locator('.dialog-btn-confirm');
    await expect(confirm).toBeVisible();
    const btn = await confirm.boundingBox();
    expect(btn.y + btn.height, `confirm button bottom at ${Math.round(btn.y + btn.height)} of 640`)
        .toBeLessThanOrEqual(640);

    // The consequence and the damage warning must be READ, not scrolled to. Detail may sit below
    // the fold; a consequence may not, so both lead the message.
    const msg = page.locator('.dialog-message');
    const top = (await msg.innerText()).slice(0, 260);
    expect(top, top).toMatch(/Restoring replaces what is here/);
    expect(top, top).toMatch(/damaged and will not open/);

    await page.locator('.dialog-btn-cancel').click();
    await expect(page.locator('#ptStatus')).toContainText('Nothing was changed');
});

test('paycalc: the card itemises what is here, and the dialog names BOTH sides', async ({ page }) => {
    // The inventory RULES are unit-tested in paycalc-inventory.test.mjs. What only a browser can
    // show is that the card asks them at all, and that the destructive dialog states what is being
    // destroyed — which until v22.14 it did not: it named one count about the incoming file and
    // nothing whatsoever about the pay history it was replacing.
    await seedSession(page, 'G. Miller');
    await page.addInitScript(PT_QUIET);
    await page.addInitScript(() => {
        localStorage.setItem('myb_pc_gmiller_p16', '{"satH":7,"satM":30}');
        localStorage.setItem('myb_pc_gmiller_bp_state_2025_26', '{"inc":true}');
        localStorage.setItem('myb_pc_gmiller_pension_timeline', '[]');
    });
    await page.goto('/paycalc.html#payTransferCard');
    await expect(page.locator('#payTransferBody')).toHaveClass(/open/);

    // The card no longer folds four features into "plus your settings".
    const items = page.locator('#ptInventory li');
    await expect(items).not.toHaveCount(0);
    const listed = (await items.allTextContents()).join(' | ');
    expect(listed, listed).toMatch(/1 payslip of entered figures/);
    // The app confirms the CURRENT tax year during boot, so the device legitimately holds two
    // years here — which is itself the fix working: `setup_<year>` was one of the four kinds the
    // old count could not see at all.
    expect(listed, listed).toMatch(/Tax years? .*2025\/26/);
    expect(listed, listed).toMatch(/Back pay/);
    expect(listed, listed).toMatch(/Pension/);

    // A backup of a DIFFERENT shape — one payslip, a different tax year — so the two halves of the
    // dialog cannot both be satisfied by the same string.
    await page.locator('#ptPaste').fill(JSON.stringify({
        format: 'myb-paycalc-backup', version: 1, member: 'G. Miller', slug: 'gmiller',
        data: {
            'myb_pc_gmiller_p20': '{"satH":1,"satM":0}',
            'myb_pc_gmiller_p21': '{"satH":2,"satM":0}',
            'myb_pc_gmiller_hpp_actual_2026_27': '1843.01',
        },
    }));
    await page.locator('#ptPasteGo').click();
    const msg = page.locator('.dialog-message');
    await expect(msg).toContainText('The backup holds:');
    await expect(msg).toContainText('2 payslips of entered figures');
    // "Tax year 2026/27" — singular, and only true of the backup half: the incoming file's one
    // year is revealed solely by an `hpp_actual` key, which the pre-v22.14 count could not see.
    await expect(msg).toContainText('Tax year 2026/27');
    await expect(msg).toContainText('This device currently holds:');
    await expect(msg).toContainText('2025/26');   // present only on the device side

    // Cancel: nothing written, and the card says so.
    await page.locator('.dialog-btn-cancel').click();
    await expect(page.locator('#ptStatus')).toContainText('Nothing was changed');
    expect(await page.evaluate(() => localStorage.getItem('myb_pc_gmiller_p20'))).toBeNull();
});

test('paycalc: backup → restore round trip survives the reload', async ({ page }) => {
    await seedSession(page, 'G. Miller');
    // The payload key is written AFTER load, never in an init script: addInitScript re-runs on the
    // post-restore reload, so a seeded value reappears on its own and the test passes even with the
    // restore's write deleted. (Confirmed the hard way — the first version of this test did exactly
    // that.) Written here, the restore is the only thing that can put the figure back.
    await page.addInitScript(PT_QUIET);
    await page.goto('/paycalc.html#payTransferCard');
    await expect(page.locator('#payTransferBody')).toHaveClass(/open/);
    await page.evaluate(() => localStorage.setItem('myb_pc_gmiller_p16', '{"satH":7,"satM":30}'));

    const backup = await page.evaluate(async () => {
        const m = await import('/paycalc-transfer.js');
        const mig = await import('/paycalc-migrations.js');
        const keys = m.selectBackupKeys(Object.keys(localStorage), mig.pcPrefix());
        const entries = Object.fromEntries(keys.map(k => [k, localStorage.getItem(k)]));
        return JSON.stringify(m.buildBackup({
            entries, member: 'G. Miller', slug: 'gmiller',
            appVersion: 'x', exportedAt: '2026-07-29T00:00:00.000Z', prefix: mig.pcPrefix(),
        }));
    });
    expect(backup).toContain('myb_pc_gmiller_p16');

    await page.evaluate(() => localStorage.setItem('myb_pc_gmiller_p16', '{"satH":0,"satM":0}'));
    await page.locator('#ptPaste').fill(backup);
    // The card reloads the page 800ms after a successful restore. WAIT FOR THAT NAVIGATION, never a
    // fixed sleep: the old `waitForTimeout(1200)` raced it — on a slow CI runner the reload was
    // still in flight when the sleep ended, so the localStorage read below landed mid-navigation
    // and died with "Execution context was destroyed". It was the suite's most frequent WebKit
    // flake (three sightings), and the flake was REAL information about the test, not the engine:
    // a sleep is a bet about someone else's timer. The listener is armed before the click that can
    // trigger the reload, so it cannot miss a fast one either.
    const reloaded = page.waitForEvent('load');
    await page.locator('#ptPasteGo').click();
    await page.locator('.dialog-btn-confirm').click();      // "Replace" — the write is gated on this
    await expect(page.locator('#ptStatus')).toContainText(/Restored/);
    await reloaded;
    expect(await page.evaluate(() => localStorage.getItem('myb_pc_gmiller_p16')))
        .toBe('{"satH":7,"satM":30}');
});

test("paycalc: another member's backup is refused and writes nothing", async ({ page }) => {
    // Option A. Staff share devices — which is precisely why the per-member namespacing exists.
    await seedSession(page, 'G. Miller');
    await page.addInitScript(PT_QUIET);
    await page.goto('/paycalc.html#payTransferCard');
    await page.locator('#ptPaste').fill(JSON.stringify({
        format: 'myb-paycalc-backup', version: 1, member: 'S. Silva', slug: 'ssilva',
        data: { myb_pc_ssilva_p16: '{}' },
    }));
    await page.locator('#ptPasteGo').click();
    await expect(page.locator('#ptStatus')).toContainText('belongs to S. Silva');
    expect(await page.evaluate(() => localStorage.getItem('myb_pc_ssilva_p16'))).toBeNull();
});

test('paycalc: an unidentifiable member cannot back up or restore', async ({ page }) => {
    // A session name that is no longer on the roster (a leaver, a rename). getLoggedMember()
    // returns null, so the per-member namespace never activates and pcPrefix() falls back to the
    // bare `myb_pc_` — which spans EVERY member on a shared device. Before v19.17 the paste box was
    // left enabled in this state, and one paste deleted two people's pay history and wrote the
    // payload unnamespaced. The session guard does not catch this: the session is valid, it is the
    // member lookup that fails.
    //
    // SINCE THE 72-HOUR REVIEW THE WHOLE CALCULATOR IS WITHHELD, not just this card: the same null
    // member also priced every figure at CEA rates in the bare shared namespace. So the page refuses
    // with the unsupported card before the namespace is ever activated — and the transfer card's own
    // fail-closed rule (validateBackup refusing an empty slug) stays, unit-tested, as the second lock.
    await seedSession(page, 'Z. NotOnRoster');
    await page.addInitScript(PT_QUIET);
    await page.goto('/paycalc.html#payTransferCard');
    await expect(page.locator('#unsupportedGradeBanner')).toBeVisible();
    await expect(page.locator('#unsupportedGradeBanner')).toContainText('current roster');
    await expect(page.locator('.pc-side'), 'the backup card must not be reachable').toBeHidden();
    await expect(page.locator('.pc-work'), 'and no figure is shown').toBeHidden();
    expect(await page.evaluate(() => Object.keys(localStorage).filter(k => /^myb_pc_p\d+$/.test(k))),
        'nothing is written into the bare shared namespace').toEqual([]);
});

test('paycalc: a restore onto storage that refuses writes changes nothing', async ({ page }) => {
    // `lsSet` SWALLOWS a storage error (ls.js, for iOS private mode), so a write that did nothing is
    // indistinguishable from one that worked — a try/catch around it is dead code. Before v19.17 the
    // card wiped first and wrote second, so a device that had stopped accepting writes lost the
    // member's entire pay history and was told "Restored". The write now happens FIRST, is verified
    // by reading back, and the surplus is only removed once that passes.
    await seedSession(page, 'G. Miller');
    await page.addInitScript(PT_QUIET);
    await page.goto('/paycalc.html#payTransferCard');
    await expect(page.locator('#payTransferBody')).toHaveClass(/open/);
    await page.evaluate(() => localStorage.setItem('myb_pc_gmiller_p16', '{"satH":7,"satM":30}'));

    const backup = await page.evaluate(async () => {
        const m = await import('/paycalc-transfer.js');
        const mig = await import('/paycalc-migrations.js');
        const keys = m.selectBackupKeys(Object.keys(localStorage), mig.pcPrefix());
        const entries = Object.fromEntries(keys.map(k => [k, localStorage.getItem(k)]));
        return JSON.stringify(m.buildBackup({
            entries, member: 'G. Miller', slug: 'gmiller',
            appVersion: 'x', exportedAt: '2026-07-29T00:00:00.000Z', prefix: mig.pcPrefix(),
        }));
    });

    // The on-device data must DIFFER from the backup, or reading back matches trivially and this
    // proves nothing. Plus a key the backup does not contain, to prove no surplus delete happened.
    await page.evaluate(() => {
        localStorage.setItem('myb_pc_gmiller_p16', 'STALE-VALUE');
        localStorage.setItem('myb_pc_gmiller_surplus', 'SHOULD-SURVIVE');
        Object.getPrototypeOf(localStorage).setItem = function () {
            throw new DOMException('quota', 'QuotaExceededError');   // as a full device does
        };
    });

    await page.locator('#ptPaste').fill(backup);
    await page.locator('#ptPasteGo').click();
    await page.locator('.dialog-btn-confirm').click();
    await expect(page.locator('#ptStatus')).toContainText('nothing was changed');
    expect(await page.evaluate(() => localStorage.getItem('myb_pc_gmiller_p16'))).toBe('STALE-VALUE');
    expect(await page.evaluate(() => localStorage.getItem('myb_pc_gmiller_surplus'))).toBe('SHOULD-SURVIVE');
});

// ── NOT IN THE PENSION SCHEME (v21.64) ───────────────────────────────────────────────────────────
//
// The reported defect was invisible on the payslip the member was looking at. She typed £0, it held,
// and it reverted on every OTHER payslip — because a payslip with no saved figure falls back to the
// scheme default, and "is she in the scheme?" was never a question the app asked. So the assertion
// that matters is not that the tick box sets £0; it is that £0 SURVIVES the two things that used to
// undo it — switching payslip, and reloading. A unit test cannot see either: both are the
// coordinator's load order (loadSettings runs, then onPeriodChange overwrites what it just wrote).
test('paycalc: the pension opt-out holds across payslips and reloads', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await seedSession(page);
    await seedMember(page);
    await page.goto('/paycalc.html');

    const amt = page.locator('#pensionAmt');
    await expect(amt).toBeVisible();
    const schemeFigure = await amt.inputValue();
    expect(schemeFigure, 'a member in the scheme starts on a real contribution').not.toBe('0.00');

    await page.locator('#pensionOptOutCheck').check();
    await expect(amt).toHaveValue('0.00');
    // Disabled, not merely zeroed: an editable field showing a figure that cannot be changed invites
    // the member to "correct" it and wonder why it will not stick.
    await expect(amt).toBeDisabled();

    // The v21.64 bug reappeared exactly here — a payslip with nothing saved against it, which
    // silently took the default. It must still hold for payslips AT OR AFTER the one she named
    // (v21.78); the payslips before it are the subject of the next test, and asserting 0.00 on
    // those is what this test used to do and what the external review correctly called a defect.
    const sel = page.locator('#periodSelect');
    const values = await sel.locator('option').evaluateAll(os => os.map(o => o.value));
    const from = Number(await page.locator('#pensionOptOutFrom').inputValue());
    const after = values.filter(v => Number(v) >= from);
    expect(after.length, 'the fixture must offer a payslip at or after the opt-out').toBeGreaterThan(0);
    for (const v of after.slice(0, 3)) {
        await sel.selectOption(v);
        await expect(amt).toHaveValue('0.00');
    }

    await page.reload();
    await expect(page.locator('#pensionOptOutCheck')).toBeChecked();
    await expect(page.locator('#pensionAmt')).toHaveValue('0.00');

    // Reversible: rejoining the scheme must put the real figure back, not leave a frozen £0 that
    // would then be saved as a deliberate opt-out on the next keystroke.
    await page.locator('#pensionOptOutCheck').uncheck();
    await expect(page.locator('#pensionAmt')).toHaveValue(schemeFigure);
    await expect(page.locator('#pensionAmt')).toBeEnabled();

    // ...AND THE STORED DEFAULT MUST AGREE WITH THE BOX (v21.77). Un-ticking left the member-level
    // default at '0.00' while the box read "in the scheme": the settings save runs before the field
    // is rebuilt, and copies whatever the field is showing at the time. The visible field is fine
    // either way — `onPeriodChange` repaints it from the grade-derived period default a moment
    // after load — which is exactly why the three assertions above still passed with the defect
    // present, and why the assertion that finds it has to read storage. Not a money error today;
    // a stored figure contradicting the choice beside it, which a pay-data backup would carry to
    // the member's next device.
    await page.reload();
    await expect(page.locator('#pensionOptOutCheck')).not.toBeChecked();
    await expect(page.locator('#pensionAmt')).toHaveValue(schemeFigure);
    await expect(page.locator('#pensionAmt')).toBeEnabled();
    const stored = await page.evaluate(() => localStorage.getItem('myb_pc_gmiller_pension'));
    expect(stored, 'the member-level pension default must not be left at the opted-out zero').not.toBe('0.00');
    expect(errors, 'Uncaught JS exceptions on the pension opt-out').toHaveLength(0);
});

// ── THE LOCK AND THE £ AGREE ON FIRST PAINT (72-hour review) ─────────────────────────────────────
//
// A payslip inside an opt-out spell that still carries an explicit saved pension (typed before she
// left, or frozen by an older Save) was PRICED with that deduction and then had its field locked to
// £0.00 — the lock ran after calculate(), with no recalc. The page read "£0.00 pension" over a
// take-home that had taken one off, until the next keystroke silently corrected it. Probed by effect:
// a recompute that changes nothing on screen must not move the £.
test('paycalc: an opted-out payslip with an old saved pension is priced at the £0 its field shows', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await seedSession(page);
    await seedMember(page);
    await page.goto('/paycalc.html');
    await expect(page.locator('#pensionAmt')).toBeVisible();
    const target = await page.locator('#periodSelect').inputValue();
    await page.evaluate((t) => {
        localStorage.setItem('myb_pc_gmiller_pension_timeline', JSON.stringify([{ from: Number(t), out: true }]));
        localStorage.setItem(`myb_pc_gmiller_p${t}`, JSON.stringify({ otH: 4, otM: 0, pension: 147.36 }));
    }, target);
    await page.reload();
    await expect(page.locator('#periodSelect')).toHaveValue(target);
    await expect(page.locator('#pensionAmt')).toHaveValue('0.00');
    await expect(page.locator('#pensionAmt')).toBeDisabled();
    const firstPaint = await page.locator('#netDisplay').textContent();
    await page.locator('#otH').fill('4');   // the same value — a recompute from what is on screen
    await expect(page.locator('#netDisplay'), 'the first paint priced a pension its field says is £0')
        .toHaveText(/** @type {string} */ (firstPaint));
    expect(errors).toHaveLength(0);
});

// ── AND IT MUST NOT REACH BACKWARDS (v21.78) ─────────────────────────────────────────────────────
//
// The defect external review found in the v21.64 opt-out, reproduced here before it was fixed: a
// 2025/26 payslip with real hours went from a £160.78 pension deduction to £0.00, and its take-home
// rose by £115.92, because the member ticked a box in August 2026.
//
// The mechanism is two good designs colliding. A period whose pension equals the expected amount
// stores `null` and re-reads the default, so it keeps healing as the app learns the real historic
// rates — and the opt-out made that default £0 for every payslip there has ever been. So the
// Settings hint's promise, "payslips from when you WERE contributing keep their own amount", held
// only for the rare payslip carrying an explicitly-typed non-default figure.
//
// This is an e2e and not a unit test on purpose: the rules are unit-tested in
// paycalc-pension.test.mjs, but the collision lives in the coordinator's load order — settings
// paint, then period restore, then calculate — and only a browser runs all three.
test('paycalc: leaving the pension scheme does not rewrite earlier payslips', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.clock.setFixedTime(new Date('2026-07-15T09:00:00Z'));
    await seedSession(page);
    await seedMember(page);
    await page.goto('/paycalc.html');
    await expect(page.locator('#pensionAmt')).toBeVisible();

    const values = await page.locator('#periodSelect option').evaluateAll(os => os.map(o => o.value));
    const oldest = values[0];
    const today  = values[values.length - 1];

    // A historical payslip with hours entered, while she was contributing. Nothing types a pension
    // figure — which is the point: the period stores `pension: null` and takes the default.
    await page.locator('#periodSelect').selectOption(oldest);
    await page.locator('#otH').fill('4');
    await expect(page.locator('#pensionAmt')).not.toHaveValue('0.00');
    const wasPension = await page.locator('#pensionAmt').inputValue();
    const wasNet     = await page.locator('#netDisplay').textContent();
    expect(await page.evaluate(k => JSON.parse(localStorage.getItem(k)).pension, `myb_pc_gmiller_p${oldest}`))
        .toBe(null);   // the self-heal that left it undefended

    // She leaves the scheme, today.
    await page.locator('#periodSelect').selectOption(today);
    await page.locator('#pensionOptOutCheck').check();
    await expect(page.locator('#pensionAmt')).toHaveValue('0.00');
    // The date is the control, and it must be visible and dated — a tick with no date is the bug.
    await expect(page.locator('#pensionOptOutField')).toBeVisible();
    await expect(page.locator('#pensionOptOutFrom')).toHaveValue(today);

    // Back to the historical payslip: unchanged, and still editable.
    await page.locator('#periodSelect').selectOption(oldest);
    await expect(page.locator('#pensionAmt')).toHaveValue(wasPension);
    await expect(page.locator('#pensionAmt')).toBeEnabled();
    expect(await page.locator('#netDisplay').textContent()).toBe(wasNet);

    // And it survives a reload — the timeline is what persists, not a boolean.
    await page.reload();
    await page.locator('#periodSelect').selectOption(oldest);
    await expect(page.locator('#pensionAmt')).toHaveValue(wasPension);
    await page.locator('#periodSelect').selectOption(today);
    await expect(page.locator('#pensionAmt')).toHaveValue('0.00');
    expect(errors, 'Uncaught JS exceptions on the pension timeline').toHaveLength(0);
});

// ── THE BACK-PAY LUMP, AS THE PAGE ACTUALLY SHOWS IT (v21.82) ────────────────────────────────────
//
// The award window fix (v21.79, VAL-PAY-001) was documented in six places and guarded in none.
// `awardWindowFactor` is unit-tested, and `_accrueBackPayPeriod` is unit-tested to honour the
// factor it is handed — but nothing checked that `calcBackPay` HANDS it one. Deleting that single
// line restores the whole defect, the app goes 19% high again, and every one of those tests stays
// green. Verified by doing exactly that before writing this.
//
// So the guard has to be the figure on screen. With NO hours entered the lump is basic + London
// only, which makes it exactly derivable and independent of anything the member did:
//
//   rate  £20.74 → £21.49  = £0.75  × 140 contracted hours = £105.00 a period
//   London £276.16 → £286.10 = £9.94                       = £114.94 a period
//   five periods in the window, the first (paid 10 Apr, shifts 8 Mar – 4 Apr) at 4/28:
//   4 × £114.94 + 4/28 × £114.94 = £476.18
//
// Without the window factor that first period counts whole — £574.70, £98.52 too much. The clock is
// pinned because the window's size depends on today: `calcBackPay` caps the accrual at today's
// payslip, so an unpinned run would quietly test a different number of periods each month.
test('paycalc: the back-pay lump scales the first period of the award window', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.clock.setFixedTime(new Date('2026-08-20T09:00:00Z'));
    await seedSession(page);
    await seedMember(page);
    await page.goto('/paycalc.html');
    await expect(page.locator('#pensionAmt')).toBeVisible();

    // The card computes whether or not it is open (v16.00) — the banner and take-home depend on it —
    // so the assertion does not need to expand anything. The hero £ is what the member reads.
    await expect(page.locator('#backPayTotalAmt')).toHaveText('£476.18');
    await expect(page.locator('#backPayTotalBasis')).toHaveText('5 periods backdated at the rates on record');
    // Compute mode, or the figure above came from a typed one and proves nothing.
    await expect(page.locator('#bpModeCompute')).toBeChecked();
    expect(errors, 'Uncaught JS exceptions on the back-pay card').toHaveLength(0);
});

// ── THE TWO OPT-IN LUMPS: THE TICK IS THE GATE, AND THE BANNER MUST AGREE WITH THE £ ─────────────
//
// Back pay and the Holiday Pay Premium are both OFF by default (owner, Jul 2026). `calculate()`
// adds each only when its own include flag is set:
//
//     const _bpThisPeriod  = (_bpPNum > 0 && _bpPNum === _pNum && _bpIncluded) ? _bpAmount : 0;
//     const _hppForPeriod  = _hppIncluded ? _hppAmount : 0;
//
// Drop `_bpIncluded` / `_hppIncluded` from those lines and **nothing in the repo fails**. The
// estimate silently gains £476.18 of back pay, or £1,843.01 of premium, while the banner directly
// beneath it still reads "could land on this payslip — not added to this estimate".
//
// That contradiction is precisely the failure `paycalc-money-banner.test.mjs` exists to prevent,
// reached from the side it cannot see: that suite pins the SENTENCE against the `included` flag it
// is handed, and nothing pins the ARITHMETIC to the same flag. So these two tests assert the pair
// together — the words and the figure, in the same browser, as one fact — because a member reading
// "not added" over a number that contains it has no way to notice, and the two states differ by
// hundreds of pounds with both looking equally plausible.
//
// The assertions are on the MOVEMENT, not on a hardcoded take-home: ticking must raise the figure,
// un-ticking must put it back exactly, and the rise must be a taxed share of the lump (more than
// nothing, less than all of it). Under either mutation the movement is ZERO in both directions.
// The clock is pinned because which payslip carries each lump depends on today.

/** Parse a rendered "£3,122.27" into a number. */
const poundsOf = (/** @type {string|null} */ s) => parseFloat(String(s ?? '').replace(/[^0-9.]/g, ''));

const LUMP_QUIET = () => {
    localStorage.setItem('myb_pc_ns_migrated', '1');
    localStorage.setItem('myb_pc_ytd_notice_2_shown', '1');
};

test('paycalc: the back-pay lump joins take-home ONLY when the tick is on', async ({ page }) => {
    const errors = collectFatalErrors(page);
    // 28 Aug 2026 is the payslip the 2026/27 award actually landed on, so the lump is offered here.
    await page.clock.setFixedTime(new Date('2026-08-20T09:00:00Z'));
    await seedSession(page);
    await seedMember(page);
    await page.addInitScript(LUMP_QUIET);
    await page.goto('/paycalc.html');
    await expect(page.locator('#pensionAmt')).toBeVisible();
    await expect(page.locator('#bpActiveBanner')).toBeVisible();

    // The lump is real money out of the real tables, not a placeholder. Derived rather than
    // written down, so the next award moves it instead of failing here: one period's arrears is
    // the hourly uplift over contracted hours plus the London Allowance step, and the window the
    // pinned clock produces is four whole periods plus the April fraction of a fifth.
    const AW = AWARD_RATES.cea['2026/27'];
    const TY = TAX_YEARS.find(t => t.label === '2026/27');
    const perPeriodUplift = (AW.rate - AW.pre) * GRADES.cea.contr + (TY.londonAllow - TY.londonAllowPre);
    const lump = poundsOf(await page.locator('#backPayTotalAmt').textContent());
    expect(lump, 'the lump is four-and-a-bit periods of the recorded uplift')
        .toBeGreaterThan(perPeriodUplift * 4);
    expect(lump).toBeLessThan(perPeriodUplift * 5);

    // OFF by default: the tick is clear, the sentence says so, and the receipt chip is absent.
    await expect(page.locator('#bpBannerTick')).not.toBeChecked();
    await expect(page.locator('#bpBannerText')).toContainText('not added to this estimate');
    await expect(page.locator('#provChips')).not.toContainText('back pay');
    const excluded = poundsOf(await page.locator('#netDisplay').textContent());
    expect(excluded, 'the take-home figure rendered').toBeGreaterThan(0);

    // ON: the sentence flips to "Includes", the same lump is named, and the figure moves.
    await page.locator('#bpBannerTick').check();
    await expect(page.locator('#bpBannerText')).toContainText('✓ Includes');
    await expect(page.locator('#bpBannerText')).toContainText('back pay lump sum');
    await expect(page.locator('#provChips')).toContainText('back pay');
    await expect.poll(async () => poundsOf(await page.locator('#netDisplay').textContent()))
        .toBeGreaterThan(excluded);
    const included = poundsOf(await page.locator('#netDisplay').textContent());

    // A taxed share of the lump: strictly more than nothing, strictly less than the whole sum.
    // Nothing is asserted about the exact deduction — that is computeTax/computeNI's own suite.
    const delta = included - excluded;
    expect(delta, 'the lump reaches take-home net of tax and NI, never in full').toBeLessThan(lump);
    expect(delta, 'and the deductions do not swallow it either').toBeGreaterThan(lump * 0.4);

    // And back off again. The round trip is what proves the tick is the gate rather than a
    // one-way door that happens to fire a recompute.
    await page.locator('#bpBannerTick').uncheck();
    await expect(page.locator('#bpBannerText')).toContainText('not added to this estimate');
    await expect.poll(async () => poundsOf(await page.locator('#netDisplay').textContent()))
        .toBe(excluded);
    expect(errors, 'Uncaught JS exceptions on the back-pay opt-in').toHaveLength(0);
});

test('paycalc: the Holiday Pay Premium joins take-home ONLY when the tick is on', async ({ page }) => {
    const errors = collectFatalErrors(page);
    // The 2025/26 premium is paid on the first January payslip of 2027 (TAX_YEARS.hppPaidJan), so
    // this clock lands the calculator on the one payslip of the year that can carry it.
    await page.clock.setFixedTime(new Date('2027-01-10T09:00:00Z'));
    await seedSession(page);
    await seedMember(page);
    // A CONFIRMED premium, seeded as the figure a member copies off the January payslip — the
    // amount here is payslip-shaped rather than rate-derived, and the gate is what is under test.
    // A confirmed actual also keeps the banner's wording free of the estimate hedge, so the two
    // sentences below discriminate on the include state alone.
    const PREMIUM = 1843.01;
    await page.addInitScript((amt) => {
        localStorage.setItem('myb_pc_ns_migrated', '1');
        localStorage.setItem('myb_pc_ytd_notice_2_shown', '1');
        localStorage.setItem('myb_pc_gmiller_hpp_actual_2025_26', String(amt));
    }, PREMIUM);
    await page.goto('/paycalc.html');
    await expect(page.locator('#pensionAmt')).toBeVisible();
    await expect(page.locator('#hppActiveBanner')).toBeVisible();

    await expect(page.locator('#hppBannerTick')).not.toBeChecked();
    await expect(page.locator('#hppBannerText')).toContainText('not added to this estimate');
    await expect(page.locator('#provChips')).not.toContainText('Holiday Pay Premium');
    const excluded = poundsOf(await page.locator('#netDisplay').textContent());
    expect(excluded, 'the take-home figure rendered').toBeGreaterThan(0);

    await page.locator('#hppBannerTick').check();
    await expect(page.locator('#hppBannerText')).toContainText('✓ Includes');
    await expect(page.locator('#hppBannerText')).toContainText('Holiday Pay Premium');
    await expect(page.locator('#provChips')).toContainText('Holiday Pay Premium');
    await expect.poll(async () => poundsOf(await page.locator('#netDisplay').textContent()))
        .toBeGreaterThan(excluded);
    const included = poundsOf(await page.locator('#netDisplay').textContent());

    const delta = included - excluded;
    expect(delta, 'the premium reaches take-home net of tax and NI, never in full').toBeLessThan(PREMIUM);
    expect(delta, 'and the deductions do not swallow it either').toBeGreaterThan(PREMIUM * 0.4);

    await page.locator('#hppBannerTick').uncheck();
    await expect(page.locator('#hppBannerText')).toContainText('not added to this estimate');
    await expect.poll(async () => poundsOf(await page.locator('#netDisplay').textContent()))
        .toBe(excluded);
    expect(errors, 'Uncaught JS exceptions on the Holiday Pay Premium opt-in').toHaveLength(0);
});

// ── THE YEAR TO DATE FIGURES ARE ANCHORED TO THE PAYSLIP THEY CAME FROM (v17.98) ─────────────────
//
// The cumulative PAYE method adds THIS payslip's pay to the entered totals, so it is only valid on
// the payslip immediately after the one the member copied them from. `calculate()` enforces that
// with one line:
//
//     if (!(_ytdSrc && _curP && _curP.num === _ytdSrc + 1)) { ytdP = null; ytdT = null; }
//
// Delete it and nothing fails. Stale totals are then treated as last-payslip figures on whatever
// payslip happens to be on screen, which is exactly the pre-v17.98 defect — a member who entered
// their figures in July and left them there gets a skewed tax estimate for the rest of the year,
// with no error and no visible difference.
//
// What makes it worth a browser is that the page ALREADY SAYS THE RIGHT THING: `_updateYtdNote`
// writes "not in use" into the header chip and "this payslip uses the standard method" into the
// note from the same rule, independently of the arithmetic. So without the guard the chip and the
// figure disagree, and the chip is the honest one. The assertion therefore pairs them.
//
// The probe is the figures' own EFFECT: clear the two boxes and see whether the take-home moves.
// On the anchored payslip it must (they are feeding the estimate); on any other payslip it must
// not (they are being ignored). The second half is vacuous without the first, which is why the
// anchored payslip is exercised in the same test rather than assumed.
test('paycalc: Year to Date figures sharpen ONLY the payslip after their source', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.clock.setFixedTime(new Date('2027-01-10T09:00:00Z'));
    await seedSession(page);
    await seedMember(page);
    // Source = P32 (paid 23 Oct 2026, internal p.num 57). Anchored payslip = 58; 59 and 60 are not.
    const SRC = 57, YTD_PAY = '30000', YTD_TAX = '4200';
    await page.addInitScript(([src, pay, tax]) => {
        localStorage.setItem('myb_pc_ns_migrated', '1');
        localStorage.setItem('myb_pc_ytd_notice_2_shown', '1');
        localStorage.setItem('myb_pc_gmiller_ytd_src_2026_27', src);
        localStorage.setItem('myb_pc_gmiller_ytd_pay_2026_27', pay);
        localStorage.setItem('myb_pc_gmiller_ytd_tax_2026_27', tax);
    }, [String(SRC), YTD_PAY, YTD_TAX]);
    await page.goto('/paycalc.html');
    await expect(page.locator('#pensionAmt')).toBeVisible();

    /** Take-home with the two boxes filled, then emptied, then refilled — on the payslip on screen. */
    const netWithAndWithoutFigures = async () => {
        await expect(page.locator('#ytdPay')).toHaveValue(YTD_PAY);
        const withFigures = poundsOf(await page.locator('#netDisplay').textContent());
        for (const id of ['#ytdPay', '#ytdTax']) {
            await page.fill(id, '');
            await page.dispatchEvent(id, 'input');
        }
        await expect(page.locator('#ytdPay')).toHaveValue('');
        const withoutFigures = poundsOf(await page.locator('#netDisplay').textContent());
        await page.fill('#ytdPay', YTD_PAY);
        await page.dispatchEvent('#ytdPay', 'input');
        await page.fill('#ytdTax', YTD_TAX);
        await page.dispatchEvent('#ytdTax', 'input');
        await expect(page.locator('#ytdPay')).toHaveValue(YTD_PAY);
        return { withFigures, withoutFigures };
    };

    // THE ANCHORED PAYSLIP — source + 1. The figures are in use, and removing them moves the £.
    await page.locator('#periodSelect').selectOption(String(SRC + 1));
    await expect(page.locator('#ytdStatusChip')).toHaveText('✓ in use');
    await expect(page.locator('#ytdUptoNote')).toContainText("sharpen this payslip's tax estimate");
    const anchored = await netWithAndWithoutFigures();
    expect(anchored.withFigures,
        'on source + 1 the entered totals must actually change the estimate — without this the '
        + 'equalities below would pass on figures nothing ever reads')
        .not.toBe(anchored.withoutFigures);

    // EVERY OTHER PAYSLIP — the chip says "not in use", and the arithmetic must agree with it.
    for (const pNum of [SRC + 2, SRC + 3]) {
        await page.locator('#periodSelect').selectOption(String(pNum));
        await expect(page.locator('#ytdStatusChip')).toHaveText('not in use');
        await expect(page.locator('#ytdUptoNote')).toContainText('uses the standard method');
        const other = await netWithAndWithoutFigures();
        expect(other.withFigures,
            `p${pNum} is not the payslip these totals came from, so they must not reach the estimate`)
            .toBe(other.withoutFigures);
    }
    expect(errors, 'Uncaught JS exceptions on the Year to Date anchor').toHaveLength(0);
});

// ── AN OVER-COLLECTED YEAR IS SAID, NOT HIDDEN BEHIND £0 (72-hour review) ────────────────────────
// computeTax reports the over-collection it clamps to £0; this pins calculate() handing it to the
// summary — the wiring a unit test of either half cannot see.
test('paycalc: Year to Date figures showing tax over-collected say a refund may be due', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.clock.setFixedTime(new Date('2027-01-10T09:00:00Z'));
    await seedSession(page);
    await seedMember(page);
    await page.addInitScript(() => {
        localStorage.setItem('myb_pc_ns_migrated', '1');
        localStorage.setItem('myb_pc_ytd_notice_2_shown', '1');
        localStorage.setItem('myb_pc_gmiller_ytd_src_2026_27', '57');
        localStorage.setItem('myb_pc_gmiller_ytd_pay_2026_27', '20000');
        localStorage.setItem('myb_pc_gmiller_ytd_tax_2026_27', '9000');   // far more than was due
    });
    await page.goto('/paycalc.html');
    await expect(page.locator('#pensionAmt')).toBeVisible();
    await page.locator('#periodSelect').selectOption('58');
    await expect(page.locator('#summary')).toContainText('may be due on this payslip');
    expect(errors).toHaveLength(0);
});

// ── THE PAYSLIP IN HAND BEFORE PAYDAY (72-hour review) ───────────────────────────────────────────
// Payslips arrive before payday. Figures typed on 22 Sep 2026 may come from the 25 Sep payslip (cut
// off 19 Sep), which the picker did not offer, so a member who had it in hand could not say so. The
// picker now offers it from its cut-off; the first-entry stamp keeps the standing rule (the payslip
// before today's), which the member corrects by picking. Rules: paycalc-periods.test.mjs.
test('paycalc: between cut-off and payday the new payslip can be picked as the Year to Date source', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.clock.setFixedTime(new Date('2026-09-22T09:00:00Z'));
    await seedSession(page);
    await seedMember(page);
    await page.addInitScript(() => {
        localStorage.setItem('myb_pc_ns_migrated', '1');
        localStorage.setItem('myb_pc_ytd_notice_2_shown', '1');
    });
    await page.goto('/paycalc.html');
    await expect(page.locator('#pensionAmt')).toBeVisible();
    await page.fill('#ytdPay', '23100');
    await page.dispatchEvent('#ytdPay', 'input');
    await page.fill('#ytdTax', '3266.20');
    await page.dispatchEvent('#ytdTax', 'input');
    const offered = await page.locator('#ytdSrcSelect option').evaluateAll(os => os.map(o => o.textContent));
    expect(offered.some(t => /25 Sep 2026/.test(t ?? '')), 'the payslip in hand must be offered').toBe(true);
    expect(offered.some(t => /28 Aug 2026/.test(t ?? ''))).toBe(true);
    expect(errors).toHaveLength(0);
});

// ── THE TWO EDITS THE CARD MAKES, IN A BROWSER (v21.80) ──────────────────────────────────────────
//
// The rules are unit-tested in paycalc-pension.test.mjs; what is tested HERE is the wiring, which
// is where both defects were. Each was silent on screen and each corrected itself out of sight on
// the next reload, which is the only reason neither showed up in a manual pass:
//
//   · Re-picking a LATER payslip did nothing. The control read one payslip and the figures used
//     another, until a reload put the control back.
//   · Un-ticking ERASED the spell rather than ending it, so the rejoin the hint under the control
//     instructs ("untick the box while viewing the first payslip that has a deduction again") gave
//     back the pension on every payslip she had been out for.
test('paycalc: the opt-out date can be corrected forward, and un-ticking records a rejoin', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.clock.setFixedTime(new Date('2026-07-15T09:00:00Z'));
    await seedSession(page);
    await seedMember(page);
    await page.goto('/paycalc.html');
    await expect(page.locator('#pensionAmt')).toBeVisible();

    const values = await page.locator('#periodSelect option').evaluateAll(os => os.map(o => o.value));
    expect(values.length, 'the fixture must offer several payslips').toBeGreaterThan(4);
    const early = values[values.length - 4];
    const mid   = values[values.length - 3];
    const later = values[values.length - 2];
    const last  = values[values.length - 1];

    // She leaves the scheme — dated, by default, to the payslip she is looking at.
    await page.locator('#periodSelect').selectOption(early);
    const schemeFigure = await page.locator('#pensionAmt').inputValue();
    expect(schemeFigure).not.toBe('0.00');
    await page.locator('#pensionOptOutCheck').check();
    await expect(page.locator('#pensionOptOutFrom')).toHaveValue(early);
    await expect(page.locator('#pensionAmt')).toHaveValue('0.00');

    // ...then corrects it FORWARD: it was actually two payslips later.
    await page.locator('#pensionOptOutFrom').selectOption(later);
    await page.locator('#periodSelect').selectOption(mid);
    await expect(page.locator('#pensionAmt'), 'a payslip she has taken back is contributing again').toHaveValue(schemeFigure);
    await expect(page.locator('#pensionAmt')).toBeEnabled();
    await page.locator('#periodSelect').selectOption(later);
    await expect(page.locator('#pensionAmt')).toHaveValue('0.00');

    // The correction is what persists — not the payslip she first picked.
    await page.reload();
    await expect(page.locator('#pensionOptOutCheck')).toBeChecked();
    await expect(page.locator('#pensionOptOutFrom')).toHaveValue(later);

    // She rejoins, and records it the way the hint tells her to: untick while viewing the first
    // payslip that has a deduction again.
    await page.locator('#periodSelect').selectOption(last);
    await page.locator('#pensionOptOutCheck').uncheck();
    await expect(page.locator('#pensionAmt')).toHaveValue(schemeFigure);
    await expect(page.locator('#pensionOptOutField'), 'the question has no answer once she is back in').toBeHidden();

    // The spell she was out for MUST survive the rejoin — erasing it was the defect.
    await page.reload();
    await expect(page.locator('#pensionOptOutCheck')).not.toBeChecked();
    await page.locator('#periodSelect').selectOption(later);
    await expect(page.locator('#pensionAmt'), 'the months she was out keep their zero').toHaveValue('0.00');
    await page.locator('#periodSelect').selectOption(last);
    await expect(page.locator('#pensionAmt')).toHaveValue(schemeFigure);
    expect(errors, 'Uncaught JS exceptions correcting the pension timeline').toHaveLength(0);
});

// The device that already carries the retired boolean. It records no date, so the migration dates
// it to the first payslip of the current tax year — and the property that makes that safe is
// directional: it can only move a payslip from a wrongly-imposed £0 back to the scheme default,
// never the reverse. Earlier tax years, which the flag was silently rewriting, come back in full.
test('paycalc: a device holding the old opt-out flag has its earlier years given back', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.clock.setFixedTime(new Date('2026-07-15T09:00:00Z'));
    await seedSession(page);
    await seedMember(page);
    await page.addInitScript(() => {
        localStorage.setItem('myb_pc_gmiller_pension_optout', '1');   // as v21.64–v21.77 wrote it
    });
    await page.goto('/paycalc.html');
    await expect(page.locator('#pensionAmt')).toBeVisible();

    // The tick is still on — she did leave the scheme, and the app must not forget that.
    await expect(page.locator('#pensionOptOutCheck')).toBeChecked();
    // ...but it now has a date, and the control that holds it is on screen to be corrected.
    await expect(page.locator('#pensionOptOutField')).toBeVisible();
    const stored = await page.evaluate(() => localStorage.getItem('myb_pc_gmiller_pension_timeline'));
    expect(stored, 'the migration must persist, not recompute on every load').toBeTruthy();

    // A prior-tax-year payslip is contributing again.
    const values = await page.locator('#periodSelect option').evaluateAll(os => os.map(o => o.value));
    await page.locator('#periodSelect').selectOption(values[0]);
    await expect(page.locator('#pensionAmt')).not.toHaveValue('0.00');
    expect(errors, 'Uncaught JS exceptions migrating the pension flag').toHaveLength(0);
});

// ── A ROLE WITH NO CONFIRMED RATES GETS NO FIGURE (v21.78) ───────────────────────────────────────
//
// The grade lookup treated "no grade stored" as CEA at every consumer, so the ten Dispatchers and
// the seven manager accounts could open this page and be handed a complete, polished take-home
// estimate computed at somebody else's rate. Nothing on screen said so, and nothing failed.
//
// Both directions are asserted, and the second matters as much as the first: a guard that refuses
// the people it should serve is a worse bug than the one it replaces.
test('paycalc: a Dispatcher is told the calculator does not cover their pay, and shown no figure', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await seedSession(page, 'D. Minto');
    await page.goto('/paycalc.html');

    await expect(page.locator('#unsupportedGradeBanner')).toBeVisible();
    // It names the two roles it DOES model and why the others are missing — "we haven't got the
    // rates" is the truth, and it tells a Dispatcher whether it is worth asking for. A bare "not
    // supported" reads as a decision rather than a gap.
    await expect(page.locator('#unsupportedGradeBanner')).toContainText('CEA');
    await expect(page.locator('#unsupportedGradeBanner')).toContainText('confirmed rates');
    // WITHHELD, not captioned — the form's whole output is one confident £ figure, and a member
    // told "this may not apply" and then handed one will use it.
    await expect(page.locator('.pc-work')).toBeHidden();
    await expect(page.locator('.pc-side')).toBeHidden();
    // ...and it is a refusal with a way out, not a dead end.
    await expect(page.locator('#navMenuBtn')).toBeVisible();
    expect(errors, 'Uncaught JS exceptions on the unsupported-role gate').toHaveLength(0);
});

// ...and at the RIGHT RATE. "a figure appeared" is not the assertion that matters here: the gate
// under test is `gradeForRole`, and its expensive failure mode produces a page that passes every
// line above — a CES computed at the CEA rate, complete, formatted, and £155 a period light on
// contracted basic alone. The grade is what the page never states in words, so it is read off the
// two places that carry it: the Settings grade picker, and the rate the period resolved to.
//
// The rate is checked against the SETS the real tables produce rather than against a literal,
// because which rate is correct depends on which payslip the page happened to open on (pre- or
// post-award) and on whatever the next award does to the figures. The two sets are disjoint, which
// is the whole property: a member priced off the wrong grade lands in the other one.
const rateSetFor = (/** @type {string} */ g) => new Set(
    [GRADES[g].rate, ...Object.values(AWARD_RATES[g]).flatMap(a => [a.rate, a.pre])]
        .filter(r => r != null).map(r => r.toFixed(2)));

for (const [name, role, grade, otherGrade] of [
    ['G. Miller', 'CEA', 'cea', 'ces'],
    ['F. Mohamed', 'CES', 'ces', 'cea'],
]) {
    test(`paycalc: a ${role} is unaffected by the unsupported-role gate, and is priced as a ${role}`, async ({ page }) => {
        const errors = collectFatalErrors(page);
        await seedSession(page, name);
        await page.goto('/paycalc.html');
        await expect(page.locator('#unsupportedGradeBanner')).toBeHidden();
        await expect(page.locator('.pc-work')).toBeVisible();
        // A real figure, not the "£–" placeholder — the calculator ran.
        await expect(page.locator('#netDisplay')).toContainText('£');
        await expect(page.locator('#netDisplay')).not.toHaveText('£–');

        // The auto-detected grade, straight off `loadSettings` → `gradeForRole(member.role)`.
        await expect(page.locator('#gradeSelect')).toHaveValue(grade);

        // And the money that follows from it. `#hourlyRate` is written by `updateRateForPeriod`
        // from the grade's own award row, so this is the first point in the chain where a wrong
        // grade becomes a wrong £.
        const rate = await page.locator('#hourlyRate').inputValue();
        const mine = rateSetFor(grade);
        const theirs = rateSetFor(otherGrade);
        expect([...mine].some(r => [...theirs].includes(r)),
            'the two grades share a rate, so this test cannot tell them apart').toBe(false);
        expect(mine.has(rate), `a ${role} was priced at £${rate} — not a ${role} rate (${[...mine].join(', ')})`).toBe(true);
        expect(theirs.has(rate), `a ${role} was priced at the ${otherGrade.toUpperCase()} rate £${rate}`).toBe(false);

        expect(errors, `Uncaught JS exceptions for ${role}`).toHaveLength(0);
    });
}

// ── THE FILL BUTTON TELLS THE TRUTH (v21.67) ─────────────────────────────────────────────────────
//
// "Replace with calendar values doesn't work" survived two fixes aimed at the tap because the
// button's FEEDBACK could not distinguish working from not: "✓ Filled" was shown unconditionally,
// the fill deliberately covers special-rate categories only (never standard weekday hours), and a
// failed shift-changes fetch silently fell back to base-only counts. These assert the honest
// states: a real fill NAMES what it filled, and a payslip with nothing fillable shows no card at
// all (the pre-existing model, pinned here so a regression can't leave an enabled no-op button).
test('paycalc: the calendar fill names what it filled', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.clock.setFixedTime(new Date('2026-07-15T09:00:00Z'));
    await seedSession(page);
    await seedMember(page);
    await page.goto('/paycalc.html');
    await expect(page.locator('#rosterHintBar')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#fillFromRosterBtn')).toBeEnabled();
    await page.locator('#fillFromRosterBtn').click();
    // The toast must name the categories it wrote — an unnamed "✓ Filled" is how a member
    // expecting weekday hours reads a working button as broken.
    await expect(page.locator('#rosterHintText')).toContainText(/✓ Filled .*(Saturday|Sunday|RDW|Overtime|Bank holiday)/);
    expect(errors, 'Uncaught JS exceptions on calendar fill').toHaveLength(0);
});

// A whole-hour fill shows "16 : 00", not "16 : 0" (polish round 2) — and that is DISPLAY ONLY: what
// is saved is the number 0, exactly as before, and a reload restores the same saved period. Two
// recorded rest days worked, 8h each, is the owner's reported case (RDW filled as 16h).
test('paycalc: a calendar fill shows two-digit minutes and saves the same number', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.clock.setFixedTime(new Date('2026-07-15T09:00:00Z'));
    await page.addInitScript(() => {
        const w = /** @type {any} */ (window);
        w.__E2E = { ...(w.__E2E || {}), docs: [
            { id: 'r1', memberName: 'G. Miller', date: '2026-07-01', type: 'rdw', value: '06:00-14:00', source: 'manual' },
            { id: 'r2', memberName: 'G. Miller', date: '2026-07-02', type: 'rdw', value: '06:00-14:00', source: 'manual' },
        ] };
    });
    await seedSession(page);
    await seedMember(page);
    await page.goto('/paycalc.html');
    await expect(page.locator('#rosterHintBar')).toBeVisible({ timeout: 10000 });
    await page.locator('#fillFromRosterBtn').click();
    await expect(page.locator('#rosterHintText')).toContainText(/✓ Filled .*RDW/);
    await expect(page.locator('#rdwH')).toHaveValue('16');
    await expect(page.locator('#rdwM'), 'a filled zero-minute box reads "00", like its placeholder').toHaveValue('00');

    const pNum = await page.locator('#periodSelect').inputValue();
    const stored = () => page.evaluate(k => JSON.parse(localStorage.getItem(k) || '{}'), `myb_pc_gmiller_p${pNum}`);
    await expect.poll(async () => (await stored()).rdwH).toBe(16);
    const before = await stored();
    expect(before.rdwM, 'the saved minutes are the NUMBER 0, not the display text').toBe(0);

    await page.reload();
    await expect(page.locator('#rdwH')).toHaveValue('16');
    expect(await stored(), 'a reload restores the same saved period').toEqual(before);
    expect(errors, 'Uncaught JS exceptions on the minutes fill').toHaveLength(0);
});

test('paycalc: a payslip with nothing fillable shows no roster card (never an enabled no-op button)', async ({ page }) => {
    const errors = collectFatalErrors(page);
    // C. Reen's fixed line is Mon–Fri only; her P16 2026 window carries no bank holiday, so every
    // special-rate count is zero — getRosterSuggestion returns null and the card must hide.
    await page.clock.setFixedTime(new Date('2026-06-20T09:00:00Z'));
    await seedSession(page, 'C. Reen');
    await seedMember(page, 'C. Reen');
    await page.goto('/paycalc.html');
    await expect(page.locator('#periodSelectTrigger')).toBeVisible();
    await expect(page.locator('#rosterHintBar')).toBeHidden();
    expect(errors, 'Uncaught JS exceptions on the empty roster card').toHaveLength(0);
});

// ── REPLACE CAN GO DOWN TO NOTHING — AND ONLY ON COMPLETE DATA (v21.68) ──────────────────────────
//
// The member-reported case that outlived three releases: a bank holiday shift removed in admin,
// stale hours still in the field, and Replace refusing to touch them — the zero-skip guard meant
// replace could overwrite values with values but never with nothing, so she "had to do it
// manually" while the phantom premium hours overstated the estimate. The pair below pins both
// directions: zero clears WHEN the calendar data is complete, and never when it is not — clearing
// on base-only counts could wipe real hours whose recorded changes simply failed to load.
test('paycalc: Replace clears stale hours the calendar no longer shows', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.clock.setFixedTime(new Date('2026-07-15T09:00:00Z'));
    await seedSession(page);
    await seedMember(page);
    await page.goto('/paycalc.html');
    await expect(page.locator('#rosterHintBar')).toBeVisible({ timeout: 10000 });
    // Her scenario: hours left behind in a category the calendar now says none for, after the shift
    // was removed in admin. Bank holiday is ROSTER-derived, which is what makes its zero assertable
    // (see CLEARABLE_CATS in paycalc-roster-hint.js).
    //
    // Period 56 is chosen, not incidental: it CONTAINS a bank holiday (so the BH input renders —
    // it is a conditional row, and outside such a period the field is hidden and unfillable) while
    // the member is not rostered on it (so the count is zero). That pair is what this test needs
    // and most periods do not have it.
    await page.locator('#periodSelect').selectOption('56');
    await expect(page.locator('#bhH')).toBeVisible();
    await page.locator('#bhH').fill('7');
    await page.locator('#fillFromRosterBtn').click();
    await expect(page.locator('#rosterHintText')).toContainText(/cleared Bank holiday/);
    await expect(page.locator('#bhH')).toHaveValue('');
    expect(errors, 'Uncaught JS exceptions clearing stale hours').toHaveLength(0);
});

test('paycalc: Replace never clears on incomplete calendar data (base-only)', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.clock.setFixedTime(new Date('2026-07-15T09:00:00Z'));
    await seedSession(page);
    await seedMember(page);
    // Every collection read rejects → the shift-changes fetch fails → 'base-only'. The missing
    // record might be exactly the hours on screen, so replace must leave them.
    await page.addInitScript(() => {
        /** @type {any} */ (window).__E2E = /** @type {any} */ (window).__E2E || {};
        /** @type {any} */ (window).__E2E.failGetDocs = true;
    });
    await page.goto('/paycalc.html');
    await expect(page.locator('#rosterHintBar')).toBeVisible({ timeout: 10000 });
    // Same period 56 as the test above, and for the same reason — a visible BH field with a zero
    // count. Here the difference is that the calendar data never arrived.
    await page.locator('#periodSelect').selectOption('56');
    await expect(page.locator('#bhH')).toBeVisible();
    await page.locator('#bhH').fill('7');
    // ...and the button must still be OFFERED here (v21.77). With the recorded changes missing,
    // "Nothing to fill this payslip" would state a fact the app has not established — and a
    // disabled button makes the tap-retries-the-fetch recovery unreachable in the one state it
    // was written for.
    await expect(page.locator('#fillFromRosterBtn')).toBeEnabled();
    await expect(page.locator('#fillFromRosterBtn')).not.toHaveText('Nothing to fill this payslip');
    await page.locator('#fillFromRosterBtn').click();
    // Give the (failing) tap-time fetch retry a beat, then confirm the hours survived.
    await page.waitForTimeout(600);
    await expect(page.locator('#bhH')).toHaveValue('7');
    expect(errors, 'Uncaught JS exceptions on base-only replace').toHaveLength(0);
});

// THE REGRESSION v21.68 SHIPPED AND v21.73 CLOSED. Giving Replace the power to clear made it able
// to destroy money: overtime, RDW and bank-holiday overtime exist ONLY where a shift change was
// recorded, so the calendar reading zero means "nothing on record", never "you worked none" — and
// at zero the row is not rendered at all, so nothing on screen warns the figure is at risk. A
// member who typed overtime from their own notes lost it, at time-and-a-quarter, to a button whose
// whole promise is that the calendar knows better. The two directions are not symmetrical: failing
// to clear costs a manual deletion the member can see; clearing wrongly is silent.
test('paycalc: Replace never clears hours the calendar only learns about second-hand', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await seedSession(page);
    await seedMember(page);
    await page.goto('/paycalc.html');
    await expect(page.locator('#rosterHintBar')).toBeVisible({ timeout: 10000 });

    // Typed from the member's own records. The stub Firestore holds no overrides, so every
    // override-only category reads zero AND the fetch state is 'loaded' — the exact combination
    // that made the old code delete them.
    await page.locator('#otH').fill('3');
    await page.locator('#otM').fill('45');
    await page.locator('#rdwH').fill('8');
    await page.locator('#fillFromRosterBtn').click();
    await expect(page.locator('#rosterHintText')).toContainText(/✓ Filled/);   // the fill DID run
    await expect(page.locator('#otH')).toHaveValue('3');
    await expect(page.locator('#otM')).toHaveValue('45');
    await expect(page.locator('#rdwH')).toHaveValue('8');
    await expect(page.locator('#rosterHintText')).not.toContainText(/cleared Overtime|cleared RDW/);
    expect(errors, 'Uncaught JS exceptions').toHaveLength(0);
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

// ── THE CONFIDENCE CHIP STAYS INSIDE ITS ROW (v23.86) ────────────────────────────────────────────
//
// Owner screenshot, 15 Sep 2026, from a phone: the RDW row in its "differs" state carried
// "Calendar: 24h 30m ·" and then "Includes an 8h estimate — check" running clean off the right edge
// of the row AND the card. The chip was `white-space: nowrap` inside a meta column that is ~110px
// wide at 390 once the icon, the label, "16h 30m entered" and the arrow have taken theirs. Nothing
// threw and every lane was green: an overflow paints, it does not fail. The longest chip is the
// estimate one, so that is the fixture — an Other-family day on a base REST day with no time, which
// resolveOtherPay routes to the RDW bucket at the 8h default (that is what sets defaulted8h.rdw).
test('paycalc: the "Includes an 8h estimate" chip wraps inside its row instead of running off the card', async ({ page }, testInfo) => {
    const errors = collectFatalErrors(page);
    await page.clock.setFixedTime(new Date('2026-07-15T09:00:00Z'));
    await seedSession(page);
    await seedMember(page);
    // Thu 9 Jul 2026 is a base rest day for G. Miller inside the period on screen (28 Jun – 25 Jul).
    await page.addInitScript(() => {
        /** @type {any} */ (window).__E2E = /** @type {any} */ (window).__E2E || {};
        /** @type {any} */ (window).__E2E.docs = [{
            id: 'o1', memberName: 'G. Miller', date: '2026-07-09',
            value: 'TRG', type: 'other', source: 'manual',
        }];
    });
    await page.goto('/paycalc.html');
    await expect(page.locator('#rosterHintBar')).toBeVisible({ timeout: 10000 });
    const row = page.locator('.roster-row[data-cat="rdw"]');
    await expect(row).toBeVisible();
    // The screenshot's state: hours entered that DISAGREE with the calendar, which is when the meta
    // column carries both the calendar figure and the chip beside a wide "entered" total.
    await page.locator('#rdwH').fill('16');
    await page.locator('#rdwM').fill('30');
    await expect(row).toHaveClass(/roster-row--differs/);
    const chip = row.locator('.conf-badge');
    await expect(chip).toContainText('8h estimate');
    const r = await row.boundingBox();
    const c = await chip.boundingBox();
    expect(r && c, 'row and chip must both lay out').toBeTruthy();
    // Inside the row on both sides — the failure was the right edge, but a chip pushed LEFT out of
    // its column would pass a right-edge-only check.
    expect(c.x + c.width, `chip right edge ${c.x + c.width} beyond row right edge ${r.x + r.width}`).toBeLessThanOrEqual(r.x + r.width + 0.5);
    expect(c.x, 'chip left edge before the row').toBeGreaterThanOrEqual(r.x - 0.5);
    // The box being inside the row is not enough: with `nowrap` still on, `max-width: 100%` caps the
    // BOX and the text runs out of it — same geometry, same overflow. scrollWidth sees the text.
    const innerOverflow = await chip.evaluate(el => el.scrollWidth - el.clientWidth);
    expect(innerOverflow, 'chip text runs past its own box').toBeLessThanOrEqual(1);
    // And it wraps as a chip, not as a tower: without the column's flex-wrap the chip is squeezed
    // beside the text to its narrowest word and stacks five lines high. Three lines is the ceiling.
    const lineHeight = await chip.evaluate(el => parseFloat(getComputedStyle(el).lineHeight));
    expect(c.height, `chip is ${c.height}px tall at a ${lineHeight}px line`).toBeLessThanOrEqual(lineHeight * 3 + 4);
    // And still readable once scrolled to: a chip that wraps must not lose its text to a clip
    // somewhere above it (the row sits below the fold on a phone, so scroll first — boundingBox
    // reads geometry off-screen, the viewport check does not).
    await chip.scrollIntoViewIfNeeded();
    await expect(chip).toBeInViewport({ ratio: 1 });
    await row.screenshot({ path: testInfo.outputPath('rdw-row.png') });
    expect(errors, 'Uncaught JS exceptions on the estimate chip').toHaveLength(0);
});
