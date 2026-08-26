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

// The data-ownership prompt is the paycalc overlay with the highest stakes — it decides whether
// another member's pay data on a shared device is claimed or discarded — so it must actually open,
// and it must be the ONLY thing open (overlay.js manages a single active overlay; two at once fight
// over Back/Escape/Tab).
//
// This USED to be a stacking test: the welcome lightbox was the competitor it had to beat. The
// welcome lightbox was retired at v19.36 and the YTD notice has been past its expiry since 5 Jul, so
// there is nothing left on this page to stack WITH — the `_ownerPending` guard in
// paycalc-lightboxes.js still exists and still suppresses the YTD notice, but it can no longer be
// exercised from the outside. What remains testable is the prompt itself, which is the part that
// matters; the loss of the priority coverage is real and deliberate, not an oversight.
test('paycalc: the data-ownership prompt opens for legacy data, and alone', async ({ page }) => {
    await seedSession(page);   // signs in as a real member (G. Miller)
    await page.addInitScript(() => {
        // Genuine unnamespaced legacy pay data → migration pending.
        localStorage.setItem('myb_pc_rate', '20.74');
        localStorage.removeItem('myb_pc_ns_migrated');
    });
    await page.goto('/paycalc.html');

    await expect(page.locator('#dataOwnerLightbox.visible')).toBeVisible();
    await expect(page.locator('.lb-overlay.visible'), 'exactly one overlay open').toHaveCount(1);
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

for (const [name, role] of [['G. Miller', 'CEA'], ['F. Mohamed', 'CES']]) {
    test(`paycalc: a ${role} is unaffected by the unsupported-role gate`, async ({ page }) => {
        const errors = collectFatalErrors(page);
        await seedSession(page, name);
        await page.goto('/paycalc.html');
        await expect(page.locator('#unsupportedGradeBanner')).toBeHidden();
        await expect(page.locator('.pc-work')).toBeVisible();
        // A real figure, not the "£–" placeholder — the calculator ran.
        await expect(page.locator('#netDisplay')).toContainText('£');
        await expect(page.locator('#netDisplay')).not.toHaveText('£–');
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

test('paycalc: a payslip with nothing fillable shows no roster card (never an enabled no-op button)', async ({ page }) => {
    const errors = collectFatalErrors(page);
    // C. Reen's fixed line is Mon–Fri only; her P16 2026 window carries no bank holiday, so every
    // special-rate count is zero — getRosterSuggestion returns null and the card must hide.
    await page.clock.setFixedTime(new Date('2026-06-20T09:00:00Z'));
    await seedSession(page, 'C. Reen');
    await seedMember(page, 'C. Reen');
    await page.goto('/paycalc.html');
    await expect(page.locator('#periodSelect')).toBeVisible();
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
