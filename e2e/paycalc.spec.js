import { test, expect, enforceNamedSession, enableInplaceLogin } from './fixtures.js';
import { collectFatalErrors, seedSession, seedMember, pickFirstMemberAndPassword, DESKTOP_WIDTHS, armEnforcementWithFailingSignIn, signInThroughOverlay } from './helpers.js';


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
            localStorage.setItem('myb_pc_pay_welcome_shown', '1');
            localStorage.setItem('myb_pc_ytd_notice_shown', '1');
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

// One-time notices must not stack: with legacy data pending AND the welcome notice
// unseen, only the data-ownership prompt (highest priority) should open — not both.
test('paycalc: one-time notices do not stack (data-ownership prompt wins)', async ({ page }) => {
    await seedSession(page);   // signs in as a real member (G. Miller)
    await page.addInitScript(() => {
        // Genuine unnamespaced legacy pay data → migration pending. Welcome unseen →
        // without the priority guard, both the welcome AND data-ownership lightboxes
        // would call .open() in the same startup tick.
        localStorage.setItem('myb_pc_rate', '20.74');
        localStorage.removeItem('myb_pc_pay_welcome_shown');
        localStorage.removeItem('myb_pc_ns_migrated');
    });
    await page.goto('/paycalc.html');

    await expect(page.locator('#dataOwnerLightbox.visible')).toBeVisible();
    await expect(page.locator('.lb-overlay.visible'), 'exactly one overlay open').toHaveCount(1);
    await expect(page.locator('#welcomeLightbox.visible'), 'welcome suppressed').toHaveCount(0);
});


// A mid-year joiner (startDate this tax year) must NOT be told to fill in payslips from before
// they were employed. The HPP + back-pay period loops skip periods entirely before startDate
// (getProRateFactor(p) === 0), fixing the "Not entered yet: 10 Apr…" + inflated "N of 13" denom
// for a joiner (v18.54 — from the max-effort review). J. Davies started 5 May 2026, so her
// 2026/27 window's 10 Apr + 8 May payslips predate her employment.
test('paycalc: a joiner is not asked to fill in pre-employment payslips', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedSession(page, 'J. Davies');   // getLoggedMember reads the session, not the calendar member
    const oneSat = JSON.stringify({ satH:8,satM:0,bhH:0,bhM:0,bhOtH:0,bhOtM:0,otH:0,otM:0,rdwH:0,rdwM:0,sunH:0,sunM:0,boxH:0,boxM:0,peer:0,slSkip:false,otherAdj:0,actualNet:null });
    await page.addInitScript((seed) => {
        localStorage.setItem('myb_pc_pay_welcome_shown','1');
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
// J. Davies (start 5 May 2026, source payslip p52) has a fixed non-premium baseline ~£2924 vs a
// buggy ~£3179; a Taxable Pay of £3050 sits between them — buggy → £0, fixed → a real figure.
test('paycalc: joiner ytd-mode HPP excludes pre-employment non-premium pay', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedSession(page, 'J. Davies');
    await page.addInitScript(() => {
        localStorage.setItem('myb_pc_pay_welcome_shown','1');
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

// ── Back up your pay data (v19.16) ────────────────────────────────────────────
// A restore REPLACES a member's entire pay history, and the rules that decide whether to do it are
// unit-tested in paycalc-transfer.test.mjs. What no unit test can prove is the WIRING — that the
// paste box reaches the ladder, that the confirmation actually gates the write, and that the data
// survives the reload. That gap is exactly the one the v19.13 tips crash fell through (a static
// suite passed; a human pressing the button found it), so the destructive path gets a real browser.
const PT_QUIET = () => {
    localStorage.setItem('myb_pc_ns_migrated', '1');
    localStorage.setItem('myb_pc_pay_welcome_shown', '1');
    localStorage.setItem('myb_pc_ytd_notice_shown', '1');
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
    const box = await page.locator('#payTransferCard').boundingBox();
    const vh = page.viewportSize().height;
    expect(box.y, `card landed at y=${Math.round(box.y)} of ${vh}`).toBeLessThan(vh / 3);
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
    await page.locator('#ptPasteGo').click();
    await page.locator('.dialog-btn-confirm').click();      // "Replace" — the write is gated on this
    await expect(page.locator('#ptStatus')).toContainText(/Restored/);
    await page.waitForTimeout(1200);                        // the card reloads the page after 800ms
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
    // payload unnamespaced. The page's own session guard does NOT catch this: the session is valid,
    // it is the member lookup that fails.
    await seedSession(page, 'Z. NotOnRoster');
    await page.addInitScript(PT_QUIET);
    await page.goto('/paycalc.html#payTransferCard');
    await expect(page.locator('#ptSummary')).toContainText("can't tell whose pay data");
    for (const id of ['#ptDownload', '#ptCopy', '#ptRestore', '#ptPasteGo', '#ptPaste']) {
        await expect(page.locator(id), `${id} must be disabled`).toBeDisabled();
    }
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
