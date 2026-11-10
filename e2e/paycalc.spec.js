import { test, expect } from './fixtures.js';
import { collectFatalErrors, seedSession, seedMember, seedMemberSession, pickFirstMemberAndPassword, DESKTOP_WIDTHS, armEnforcementWithFailingSignIn, signInThroughOverlay, clickInView, isTouchProject, waitForPageSettled, waitForReadsToLand } from './helpers.js';
// The REAL pay tables, imported rather than restated: the unsupported-role block below asserts that
// a CES is priced as a CES, and a literal rate there would go stale on the next award — or, worse,
// be "corrected" to whatever the page happened to show.
import { GRADES, AWARD_RATES, TAX_YEARS, computeGross, computeTax, computeNI, getThresholds, getPensionForPeriod } from '../paycalc-calc.js';


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

// ── The payslip in hand, and the two settings that explain most big gaps (v24.87) ────────────────
// A colleague held her 23 Oct 2026 payslip on the 22nd and found no box to check it in: it appeared
// only from payday. And her £111.51 gap came from two settings — no pension, the default tax code —
// which the old line never mentioned. The wording is unit-tested (paycalc-breakdown.test.mjs); THIS
// pins the wiring: that the box keys off the payslip in hand, and that the line is handed the code
// and pension the estimate really used, not the box contents or a default.
test('paycalc: the payslip check is there while the payslip is in hand, and names this estimate\'s tax code and pension', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.clock.setFixedTime(new Date('2026-10-22T09:00:00Z'));   // cut off on the 17th, pays the 23rd
    await seedSession(page);
    await page.addInitScript(() => { localStorage.setItem('myb_pc_ns_migrated', '1'); });
    await page.goto('/paycalc.html?payday=2026-10-23');
    await expect(page.locator('#pensionAmt')).toBeVisible();
    await expect(page.locator('#checkActualWrap'), 'before payday, with the payslip in hand').toBeVisible();

    const verdict = page.locator('#actualVerdict');
    await page.locator('#taxCode').fill('1182L');
    await page.locator('#actualNetInput').fill('1000');                 // far from any estimate: the big-gap line
    await expect(verdict).toContainText('this estimate uses tax code 1182L and a pension of £151.86.');
    // The pension the ESTIMATE took, read through the same path as the figure: a typed 0 is an opt-out.
    await page.locator('#pensionAmt').fill('0');
    await expect(verdict).toContainText('this estimate uses tax code 1182L and no pension.');
    // And a blank Tax Code box is named as what the calculation made of it.
    await page.locator('#taxCode').fill('');
    await expect(verdict).toContainText('this estimate uses tax code 1257L and no pension.');
    // A code the calculator cannot read is priced on the standard allowance, so it is never quoted as
    // the code in use (v24.89) — "OT" with a letter O beside a payslip's 0T was the case found.
    await page.locator('#taxCode').fill('OT');
    await expect(verdict).toContainText("The tax code in Your Settings, OT, isn't one the calculator recognises");
    await expect(verdict).not.toContainText('this estimate uses tax code OT');

    // The NEXT payslip has not been cut off yet, so it cannot be in anybody's hand.
    const next = await page.locator('#periodSelect option').evaluateAll(os =>
        os.find(o => /20 Nov 2026/.test(o.textContent ?? ''))?.getAttribute('value') ?? null);
    expect(next, 'the 20 Nov payslip is on the list').not.toBeNull();
    await page.locator('#periodSelect').selectOption(/** @type {string} */ (next));
    await expect(page.locator('#checkActualWrap')).toBeHidden();
    expect(errors).toHaveLength(0);
});

// ── A CODE THE CALCULATOR DOES NOT RECOGNISE, SAID WHERE IT MATTERS (whole-app review, Nov 2026) ──
// Priced on the standard 1257L allowance, and only the check line above said so — hidden until the
// payslip's cut-off. The words are unit-tested; this pins calculate() handing computeTax's own flag to
// the Income Tax row, the box's warning and the Year to Date line, on the payslip the page opens on.
test('paycalc: an unrecognised tax code is named under Income Tax and the box, and the Year to Date line holds back', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.clock.setFixedTime(new Date('2026-11-07T09:00:00Z'));   // 20 Nov is next; 23 Oct is paid
    await seedSession(page);
    await seedMember(page);
    await page.addInitScript(() => {
        localStorage.setItem('myb_pc_ns_migrated', '1');
        localStorage.setItem('myb_pc_ytd_notice_2_shown', '1');
    });
    await page.goto('/paycalc.html');
    await expect(page.locator('#pensionAmt')).toBeVisible();
    await page.locator('#periodSelect').selectOption('58');
    const line = page.locator('#netYtdNudge');
    await expect(line, 'premise: with 1257L the line asks for the figures').toBeVisible();

    await page.locator('#taxCode').fill('OT');
    await expect(page.locator('#summary')).toContainText("Tax code OT isn't one the calculator recognises");
    await expect(line, 'with a wrong code the figures make the estimate worse').toBeHidden();
    await expect(page.locator('#taxCodeWarn.show'), 'nothing flashes while the box is being typed in').toHaveCount(0);
    await page.locator('#taxCode').blur();
    const warn = page.locator('#taxCodeWarn');
    await expect(warn).toBeVisible();
    await expect(warn).toContainText('0T and D0 are written with a zero, not the letter O');

    await page.locator('#taxCode').fill('0T');
    await page.locator('#taxCode').blur();
    await expect(warn).toBeHidden();
    await expect(page.locator('#summary')).not.toContainText('recognises');
    expect(errors).toHaveLength(0);
});

// A payday the calculator does not carry used to open the current payslip silently (whole-app review).
test('paycalc: a link to a payday outside the calculator says so, and a covered one says nothing', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-22T09:00:00Z'));
    await seedSession(page);
    await page.addInitScript(() => { localStorage.setItem('myb_pc_ns_migrated', '1'); });
    await page.goto('/paycalc.html?payday=2027-04-09');
    const note = page.locator('#periodLinkNote');
    await expect(note).toBeVisible();
    await expect(note).toContainText("There's no payslip for 9 Apr 2027 in the calculator");
    await page.goto('/paycalc.html?month=2027-06');
    await expect(note).toContainText('Jun 2027');
    await page.goto('/paycalc.html?payday=2026-10-23');
    await expect(page.locator('#pensionAmt')).toBeVisible();
    await expect(note).toBeHidden();
});

// ── THE GOLD HIGHLIGHT MEANS "FROM YOUR CALENDAR", AND NOTHING ELSE (whole-app review, Oct 2026) ──
// The roster snapshot stores 0/0 for every category the calendar had nothing for, and a BLANK
// minutes box matched it — so every reload painted empty boxes gold and put "📅 Hours from
// calendar" under hours typed by hand (a regression from v24.35).
const SNAP_ZEROES = { bhH: 0, bhM: 0, bhOtH: 0, bhOtM: 0, otH: 0, otM: 0, rdwH: 0, rdwM: 0, boxH: 0, boxM: 0 };

test('paycalc: a blank box the calendar suggested nothing for is never gold, and the chip says so', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-22T09:00:00Z'));
    await seedSession(page);
    await page.addInitScript((zeroes) => {
        localStorage.setItem('myb_pc_ns_migrated', '1');
        // Hand-typed Saturday and Sunday that differ from what the calendar once suggested.
        localStorage.setItem('myb_pc_gmiller_p57', JSON.stringify({ satH: 9, satM: 5, sunH: 17, sunM: 5 }));
        localStorage.setItem('myb_pc_gmiller_snap_57', JSON.stringify({ satH: 8, satM: 30, sunH: 16, sunM: 30, ...zeroes }));
    }, SNAP_ZEROES);
    await page.goto('/paycalc.html?payday=2026-10-23');
    await expect(page.locator('#satH')).toHaveValue('9');
    for (const id of ['otM', 'rdwM', 'otH', 'rdwH']) {
        await expect(page.locator('#' + id), `${id} is blank and was suggested nothing`).not.toHaveClass(/roster-suggested/);
    }
    await expect(page.locator('#provChips')).not.toContainText('Hours from calendar');
});

test('paycalc: editing a calendar-filled box takes "Hours from calendar" away at once', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-22T09:00:00Z'));
    await seedSession(page);
    await page.addInitScript((zeroes) => {
        localStorage.setItem('myb_pc_ns_migrated', '1');
        // Saturday exactly as the calendar filled it, so it comes back gold; Sunday typed by hand, so
        // the background calendar read leaves it alone and Saturday is the only gold on the card.
        localStorage.setItem('myb_pc_gmiller_p57', JSON.stringify({ satH: 8, satM: 30, sunH: 17, sunM: 5 }));
        localStorage.setItem('myb_pc_gmiller_snap_57', JSON.stringify({ satH: 8, satM: 30, sunH: 16, sunM: 30, ...zeroes }));
    }, SNAP_ZEROES);
    await page.goto('/paycalc.html?payday=2026-10-23');
    await expect(page.locator('#satH')).toHaveClass(/roster-suggested/);
    await expect(page.locator('#provChips')).toContainText('Hours from calendar');
    // The field's own autosave → calculate() rebuilds the chips in the same input event, so the
    // class must already be gone when it does — otherwise the chip outlives the edit.
    // And the minutes beside it are the member's now too — one pair, one author.
    await page.locator('#satH').fill('9');
    await expect(page.locator('#satH')).not.toHaveClass(/roster-suggested/);
    await expect(page.locator('#satM')).not.toHaveClass(/roster-suggested/);
    await expect(page.locator('#provChips')).not.toContainText('Hours from calendar');
});

// ── A REFRESHED CALENDAR FIGURE THE MEMBER SAVES IS STILL THE CALENDAR'S (paycalc-3-1, 10 Nov 2026) ──
// The background refresh SHOWS a changed calendar figure gold without saving it (invariant 11), and
// the member's next edit anywhere on the payslip saves it with the rest (implicit acceptance). The
// snapshot saying which saved figures came from the calendar must then describe what was saved —
// autosave re-records it (`recordCalendarFigures`) — or the saved 16 below stops being gold and stops
// following the calendar's next change.
test('paycalc: a refreshed calendar figure the member saves keeps following the calendar', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.setViewportSize({ width: 390, height: 900 });
    await page.clock.setFixedTime(new Date('2026-07-15T09:00:00Z'));
    await seedSession(page);
    await seedMember(page);
    // The calendar's answer is read from sessionStorage at each load, so a reload can change it.
    await page.addInitScript(() => {
        const w = /** @type {any} */ (window);
        const times = sessionStorage.getItem('rdwTimes') || '08:00-16:00';
        w.__E2E = { ...(w.__E2E || {}), docs: [{ id: 'o1', memberName: 'G. Miller', date: '2026-07-09', type: 'rdw', value: times, source: 'manual' }] };
    });
    const loaded = () => expect(page.locator('#rosterStateBadge')).toContainText('Includes recorded changes', { timeout: 10000 });
    const rdw = page.locator('#rdwH');

    await page.goto('/paycalc.html');
    await loaded();
    await page.locator('#fillFromRosterBtn').click();
    await expect(rdw, 'premise: the calendar\'s 8 hours, filled and saved').toHaveValue('8');

    await page.evaluate(() => sessionStorage.setItem('rdwTimes', '06:00-22:00'));
    await page.reload();
    await loaded();
    await expect(rdw, 'premise: the calendar\'s new 16 hours are shown, not saved').toHaveValue('16');
    await expect(rdw).toHaveClass(/roster-suggested/);

    await page.locator('#otH').fill('1');   // an edit elsewhere saves the payslip, the gold 16 with it
    await page.locator('#otH').blur();

    await page.evaluate(() => sessionStorage.setItem('rdwTimes', '06:00-24:00'));
    await page.reload();
    await loaded();
    await expect(rdw, 'the saved 16 came from the calendar, so it is still gold').toHaveClass(/roster-suggested/);
    await expect(rdw, '…and follows the calendar to its 18 hours').toHaveValue('18');
    expect(errors, `fatal errors: ${errors.join(', ')}`).toHaveLength(0);
});

// Whole-app review, Oct 2026: a SETTING change (the loan plan, the pension scheme) ran the payslip's
// autosave, which writes the whole form — the calendar's display-only suggestion with it (invariant 11:
// viewing never persists) — and wrote over saved entries that could not be read.
const changeSettings = (/** @type {import('@playwright/test').Page} */ page) => page.evaluate(() => {
    const fire = (/** @type {string} */ id, /** @type {(el: any) => void} */ set) => {
        const el = /** @type {any} */ (document.getElementById(id));
        set(el); el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    fire('studentLoan', el => { el.value = 'plan2'; });
    fire('pgLoanCheck', el => { el.checked = true; });
    fire('pensionOptOutCheck', el => { el.checked = true; });
});
test('paycalc: changing a setting never saves the calendar\'s suggestion as entered hours', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-22T09:00:00Z'));
    await seedSession(page);
    await page.addInitScript(() => localStorage.setItem('myb_pc_ns_migrated', '1'));
    await page.goto('/paycalc.html?payday=2026-10-23');
    await expect(page.locator('#satH'), 'premise: the calendar\'s Saturday is shown, not saved').toHaveClass(/roster-suggested/);
    const saved = () => page.evaluate(() => localStorage.getItem('myb_pc_gmiller_p57'));
    expect(await saved()).toBeNull();
    await changeSettings(page);
    await expect(page.locator('#netDisplay')).not.toBeEmpty();
    expect(await saved(), 'a setting saved the suggestion as though the member had entered it').toBeNull();
});

test('paycalc: changing a setting never writes over saved entries that could not be read', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-22T09:00:00Z'));
    await seedSession(page);
    await page.addInitScript(() => {
        localStorage.setItem('myb_pc_ns_migrated', '1');
        localStorage.setItem('myb_pc_gmiller_p57', '{not json');
    });
    await page.goto('/paycalc.html?payday=2026-10-23');
    await expect(page.locator('.save-status.corrupt')).toBeVisible();
    await changeSettings(page);
    expect(await page.evaluate(() => localStorage.getItem('myb_pc_gmiller_p57')),
        'only something the member TYPES may replace damaged entries').toBe('{not json');
});

test('paycalc: with Year to Date figures in use, a payslip gap names the payslip they count from (v24.89)', async ({ page }) => {
    /*
     * On 22 Oct a first entry is stamped with the 25 Sep payslip — the latest PAID one — while a
     * member holding the 23 Oct payslip copies from that: its pay is then counted twice (£193.40 out,
     * the 48-hour review). The card names its payslip; this is the line a member chasing the gap
     * reads, and it is only as good as the calculator handing it the anchor actually used.
     */
    const errors = collectFatalErrors(page);
    await page.clock.setFixedTime(new Date('2026-10-22T09:00:00Z'));   // the 23 Oct payslip is in hand
    await seedSession(page);
    await seedMember(page);
    await page.addInitScript(() => {
        localStorage.setItem('myb_pc_ns_migrated', '1');
        localStorage.setItem('myb_pc_ytd_notice_2_shown', '1');
        localStorage.setItem('myb_pc_gmiller_ytd_src_2026_27', '56');   // paid 25 Sep — the first-entry stamp that day
        localStorage.setItem('myb_pc_gmiller_ytd_pay_2026_27', '21000');
        localStorage.setItem('myb_pc_gmiller_ytd_tax_2026_27', '2800');
    });
    await page.goto('/paycalc.html?payday=2026-10-23');
    await expect(page.locator('#ytdStatusChip')).toHaveText('✓ in use');
    await page.locator('#actualNetInput').fill('1000');                 // far from any estimate: the big-gap line
    const verdict = page.locator('#actualVerdict');
    await expect(verdict).toContainText('It also counts your Year to Date figures as copied from your 25 Sep payslip');
    // The 23 Oct payslip chosen instead: the figures now sharpen the NEXT payslip, so this one's line
    // stops naming them.
    await page.locator('#ytdSrcSelect').selectOption('57', { force: true });
    await expect(page.locator('#ytdStatusChip')).not.toHaveText('✓ in use');
    await expect(verdict).toContainText('this estimate uses tax code');
    await expect(verdict).not.toContainText('counts your Year to Date figures');
    expect(errors).toHaveLength(0);
});

test('paycalc: the payslip comparison renders per typed line and survives a reload', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await seedSession(page);
    await page.addInitScript(() => { localStorage.setItem('myb_pc_ytd_notice_2_shown', '1'); });
    await page.goto('/paycalc.html');
    await expect(page.locator('#periodSelect option').first()).toBeAttached();
    // A PAID period — the check block renders once a payslip may be in hand (from its cut-off,
    // v24.87), and P2's payday is long past.
    await page.locator('#periodSelect').selectOption({ index: 1 });
    await expect(page.locator('#checkActualWrap')).toBeVisible();

    await clickInView(page.locator('#actualMoreBtn'));
    await expect(page.locator('#actualMoreWrap')).toBeVisible();
    await page.locator('#actualGrossInput').fill('3808.87');
    await page.locator('#actualTaxInput').fill('540.20');
    const table = page.locator('#actualCompare table.actual-cmp');
    await expect(table).toBeVisible();
    await expect(table).toContainText('Taxable Pay');
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

// ── LIKE WITH LIKE (whole-app check, 10 Nov 2026) ──────────────────────────────────────────────
// The payslip's pay figure is its Taxable Pay, AFTER the pension, and the comparison set it against
// the estimate's Total pay, BEFORE it — so a perfect estimate showed the whole pension as a gap. The
// figure typed here is the estimate's own "Pay after pension deduction", read off the summary, so the
// row must read as a match.
test('paycalc: the comparison sets the payslip\'s Taxable Pay against the pay after the pension', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await seedSession(page);
    await page.addInitScript(() => { localStorage.setItem('myb_pc_ytd_notice_2_shown', '1'); });
    await page.goto('/paycalc.html');
    await expect(page.locator('#periodSelect option').first()).toBeAttached();
    await page.locator('#periodSelect').selectOption({ index: 1 });
    await expect(page.locator('#checkActualWrap')).toBeVisible();

    const afterPension = page.locator('#summary .sum-row', { hasText: 'Pay after pension deduction' }).locator('.val');
    await expect(afterPension).toBeVisible();
    const figure = (await afterPension.textContent() ?? '').replace(/[£,]/g, '').trim();
    expect(Number(figure)).toBeGreaterThan(0);

    await clickInView(page.locator('#actualMoreBtn'));
    await page.locator('#actualGrossInput').fill(figure);
    const row = page.locator('#actualCompare table.actual-cmp tbody tr', { hasText: 'Taxable Pay' });
    await expect(row).toBeVisible();
    await expect(row.locator('td').last()).toHaveText('—');
    await expect(row.locator('td').last()).toHaveClass(/cmp-same/);

    expect(errors, `fatal errors: ${errors.join(', ')}`).toHaveLength(0);
});

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
    await seedSession(page, 'C. Reen');
    const sat = JSON.stringify({ satH: 40, satM: 0, bhH: 0, bhM: 0, bhOtH: 0, bhOtM: 0, otH: 0, otM: 0, rdwH: 0, rdwM: 0,
        sunH: 0, sunM: 0, boxH: 0, boxM: 0, peer: 0, slSkip: false, otherAdj: 0, actualNet: null });
    await page.addInitScript((seed) => {
        localStorage.setItem('myb_pc_ns_migrated', '1');
        localStorage.setItem('myb_pc_ytd_notice_2_shown', '1');
        localStorage.setItem('myb_pc_creen_grade', 'cea');
        localStorage.setItem('myb_pc_creen_setup', '1');
        localStorage.setItem('myb_pc_creen_p45', seed);   // a 2025/26 payslip with premium hours
    }, sat);
    await page.goto('/paycalc.html');
    await expect(page.locator('#netDisplay')).toHaveText(/£\d/);
    await expect(page.locator('#periodSelect')).toHaveValue('59');
    await page.evaluate(() => {
        localStorage.removeItem('myb_pc_creen_hpp_est_2025_26');
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
    });

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
    await seedSession(page, 'J. Davies');   // started 5 May 2026 — employed for none of 2025/26
    await page.addInitScript(() => {
        localStorage.setItem('myb_pc_ns_migrated', '1');
        localStorage.setItem('myb_pc_jdavies_grade', 'cea');
        localStorage.setItem('myb_pc_jdavies_setup', '1');
    });
    await page.goto('/paycalc.html');
    await expect(page.locator('#netDisplay')).toHaveText(/£\d/);
    await page.locator('#periodSelect').selectOption('60');
    await expect(page.locator('#periodSelect')).toHaveValue('60');
    await expect(page.locator('#priorHppSection'), 'premise: the last-year section is hidden from a joiner').toHaveClass(/hidden/);
    await expect(page.locator('#ytdJanHppHint')).toHaveJSProperty('hidden', true);

    expect(errors, `fatal errors: ${errors.join(', ')}`).toHaveLength(0);
});

// ── ONE EDIT REACHES THE FIGURES THAT READ STORAGE (whole-app review, Oct 2026) ───────────────
// autosave() priced the page BEFORE it saved, and "This tax year so far" — like the Holiday Pay
// Premium card and its stored estimate, the figure a January payslip adds — reads the payslip back
// from storage. So each lagged one edit behind: the first keystroke changed the result card and
// nothing that summed the year. One input here, and the block must move without a second one.
test('paycalc: one edit reaches "This tax year so far" at once, not on the next edit', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.clock.setFixedTime(new Date('2026-10-25T09:00:00Z'));
    await seedSession(page);
    await page.addInitScript(() => {
        localStorage.setItem('myb_pc_ns_migrated', '1');
        localStorage.setItem('myb_pc_ytd_notice_2_shown', '1');
        // Internal period 51 is the 8 May 2026 payday (48 is 13 Feb 2026; a period is 28 days).
        localStorage.setItem('myb_pc_gmiller_p51', JSON.stringify({
            satH: 7, satM: 0, bhH: 0, bhM: 0, bhOtH: 0, bhOtM: 0, otH: 0, otM: 0,
            rdwH: 0, rdwM: 0, sunH: 0, sunM: 0, boxH: 0, boxM: 0, peer: 0,
            slSkip: false, otherAdj: 0, actualNet: null,
        }));
    });
    await page.goto('/paycalc.html?payday=2026-05-08');
    const block = page.locator('#ytdYearSoFar');
    // SETTLED before it is read: the block's first paint is not its last, and a "before" taken from
    // an earlier one made this pass against the very order it exists to refuse.
    await expect(block).toContainText('1 of 8 paid payslips entered');
    await page.waitForLoadState('networkidle');
    const before = await block.innerText();
    // READ ONCE, NOT POLLED. The input handler prices the page synchronously, so the block is
    // already what this edit made it; a polling assertion would wait for whatever recalculates
    // NEXT, and that later pass reads storage after the save — hiding exactly this lag.
    await page.locator('#otH').fill('10');
    const afterFirst = await block.innerText();
    expect(afterFirst, 'the year still reads the payslip as it was before this edit').not.toBe(before);
    await page.locator('#otH').fill('0');
    expect(await block.innerText(), 'and the next edit moves it again, not to the state one edit ago').not.toBe(afterFirst);
    expect(errors, `fatal errors: ${errors.join(', ')}`).toHaveLength(0);
});

// ── Fill this tax year from Calendar (v22.06) ─────────────────────────────────────────────────
// The rules are unit-tested (paycalc-fill-year.test.mjs); only a browser can prove the WIRING —
// that the button the "Not entered yet" line offers runs the real engine against the real
// storage, that the receipt lands, and that a period the member ENTERED survives the bulk write.

// THE CLOCK IS PINNED for Fill-the-year and for the joiner pair further down (test audit, 7 Nov 2026
// — PAY-19). Each is about the 2026/27 tax year — the year whose payslips a bulk fill reaches, and the
// joiner's first — and on the real clock the page opens on whatever tax year today is in, so from
// April 2027 they would quietly be testing a different year: a fill that never goes near the seeded
// payslip, and a joiner employed the whole year through. 7 Nov 2026 is the day these were last read
// against the real clock, with identical results.
const PAY_2026_27_DAY = new Date('2026-11-07T09:00:00Z');

test('paycalc: Fill-the-year fills the empty paid periods, receipts by date, and spares entered data', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.clock.setFixedTime(PAY_2026_27_DAY);   // inside 2026/27, the year p51 belongs to — see above
    await seedSession(page);
    // One period the member typed by hand — the untouchable one. The 8 May 2026 payslip is long paid;
    // 7h of Saturday is unmistakably hand-shaped data, and that payslip's calendar would suggest far more
    // (three rostered Saturdays, Easter Monday and a Sunday), so a bulk fill over it cannot hide.
    // STORAGE KEYS USE THE INTERNAL PERIOD NUMBER, NOT THE PRINTED ONE: 8 May 2026 is p51 (the 13 Feb
    // 2026 anchor is p48, the range runs p37–p62) and prints as P8. This seeded `p2` until 7 Nov 2026
    // (test audit) — a key no period reads, so "the entered period survived" could not fail.
    await page.addInitScript(() => {
        // 'G. Miller' → memberSlug 'gmiller'; the trailing _ is pcPrefix's namespace separator.
        localStorage.setItem('myb_pc_ytd_notice_2_shown', '1');   // its lightbox would cover the button
        localStorage.setItem('myb_pc_gmiller_p51', JSON.stringify({
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
    const lumpBefore = await page.locator('#backPayTotalAmt').textContent();
    await clickInView(page.locator('#fillYearBtn'));

    // The receipt: filled payslips BY DATE, plus the review-before-relying line.
    await expect(block.locator('.yearso-receipt')).toContainText(/Filled \d+ payslips? from your calendar/);
    await expect(block.locator('.yearso-receipt')).toContainText('Review the suggested hours');

    // The back-pay lump accrues from those hours too (paycalc-2-2, whole-app check, 10 Nov 2026): it
    // moves with the fill, to exactly what a fresh look at the payslip gives.
    const lumpAfter = await page.locator('#backPayTotalAmt').textContent();
    expect(lumpAfter, 'the fill moves the lump at once — the filled hours sit inside the award window').not.toBe(lumpBefore);
    const viewed = await page.locator('#periodSelect').inputValue();
    await page.locator('#periodSelect').selectOption(String(Number(viewed) - 1));
    await page.locator('#periodSelect').selectOption(viewed);
    await expect(page.locator('#backPayTotalAmt')).toHaveText(lumpAfter ?? '');

    // The entered period survived byte-for-byte — rule 1, proven against real storage.
    const entered = await page.evaluate(() => JSON.parse(localStorage.getItem('myb_pc_gmiller_p51') || 'null'));
    expect(entered.satH).toBe(7);
    // …and at least one previously-empty paid period now holds data plus its gold snapshot.
    const filled = await page.evaluate(() => {
        const out = [];
        for (const k of Object.keys(localStorage)) {
            if (/^myb_pc_gmiller_p\d+$/.test(k) && k !== 'myb_pc_gmiller_p51') out.push(k);
        }
        return out.map(k => ({ k, snap: !!localStorage.getItem(k.replace(/_p(\d+)$/, '_snap_$1')) }));
    });
    expect(filled.length).toBeGreaterThan(0);
    expect(filled.every(f => f.snap), 'every bulk fill must carry its roster-suggested snapshot').toBe(true);

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
        const rgb = (/** @type {string} */ c) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = c; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3); };
        const lum = (/** @type {number[]} */ c) => c.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; })
            .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
        const fill = (/** @type {string} */ id) => lum(rgb(getComputedStyle(/** @type {Element} */ (document.getElementById(id))).backgroundColor));
        const sheet = fill('dataOwnerContent');
        return ['dataOwnerMine', 'dataOwnerFresh'].map(id => {
            const [hi, lo] = [fill(id), sheet].sort((a, b) => b - a);
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


// A mid-year joiner (startDate this tax year) must NOT be told to fill in payslips from before
// they were employed. The HPP + back-pay period loops skip periods entirely before startDate
// (getProRateFactor(p) === 0), fixing the "Not entered yet: 10 Apr…" + inflated "N of 13" denom
// for a joiner (v18.54 — from the max-effort review). The joiner seeded below started 5 May 2026
// (a start date, from the public roster — no payslip of theirs is involved), so their 2026/27
// window's 10 Apr + 8 May payslips predate their employment.
test('paycalc: a joiner is not asked to fill in pre-employment payslips', async ({ page }) => {
    await page.clock.setFixedTime(PAY_2026_27_DAY);
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
    await seedSession(page, 'J. Davies');
    await page.addInitScript(() => {
        localStorage.setItem('myb_pc_ns_migrated','1');
        localStorage.setItem('myb_pc_jdavies_grade','cea');
        localStorage.setItem('myb_pc_jdavies_setup','1');
        localStorage.setItem('myb_pc_jdavies_ytd_src_2026_27','52');
    });
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
    // what it is. (The prototype was not adopted — DECISIONS.md, "More pay tools" — but the weakness
    // it found in this test was real.)
    const card = page.locator('#payTransferCard');
    await expect(card, 'the backup card must be visible before its landing position means anything').toBeVisible();
    const box = await card.boundingBox();
    const vh = page.viewportSize().height;
    expect(box.y, `card landed at y=${Math.round(box.y)} of ${vh}`).toBeLessThan(vh / 3);
});

// ── The Calendar's Year to Date notice (v24.86) ───────────────────────────────────────────────────
// Its rules — the load after the timetable notice, CEA/CES only, a one-off, ending on 31 October — are
// unit-tested in calendar-notices.test.mjs. These are the halves only a browser can prove: the order
// across two real loads, and that its link lands a member on the card it teaches, open, with nothing
// else in the way. Clock pinned inside both notices' life (22–31 Oct 2026) and the Pay page's own
// Year to Date notice's (to ~26 Nov), so neither silently retires and leaves these proving nothing.
const YTD_NOTICE_DAY = new Date('2026-10-22T09:00:00Z');

test('paycalc: the Calendar\'s Year to Date link lands on that card OPEN, and the Pay notice stays out of its way', async ({ page }) => {
    // Phone width for the same reason as the backup card's deep link above: on one column the card
    // sits far down a page that keeps growing after load, which is what the correction is for.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.clock.setFixedTime(YTD_NOTICE_DAY);
    await seedSession(page);
    await page.addInitScript(() => {
        localStorage.setItem('myb_pc_ns_migrated', '1');
        // The Pay page's own Year to Date notice, UNSEEN — on a clean device it opens (the test
        // above proves it). Arriving by this link must count as having been told.
        localStorage.removeItem('myb_pc_ytd_notice_2_shown');
    });
    await page.goto('/paycalc.html#payslipCard');
    await expect(page.locator('#payslipCardBody')).toHaveClass(/open/);

    await page.waitForTimeout(900);
    const card = page.locator('#payslipCard');
    await expect(card, 'the card must be visible before its landing position means anything').toBeVisible();
    const box = await card.boundingBox();
    const vh = page.viewportSize().height;
    expect(box.y, `card landed at y=${Math.round(box.y)} of ${vh}`).toBeLessThan(vh / 3);

    // Flagged seen without ever having opened over the two boxes it asks the member to fill.
    await expect.poll(() => page.evaluate(() => localStorage.getItem('myb_pc_ytd_notice_2_shown'))).toBe('1');
    await page.waitForTimeout(1500);
    await expect(page.locator('#noticeYtdLightbox.visible')).toHaveCount(0);
});

test('the Calendar\'s Year to Date notice comes the load AFTER the timetable one, and its link opens the card', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.clock.setFixedTime(YTD_NOTICE_DAY);
    await seedSession(page, 'G. Miller');
    await seedMemberSession(page, 'G. Miller');
    await seedMember(page, 'G. Miller');
    // Registered AFTER the seeders, which mark every Calendar notice done on every load. The Year to
    // Date notice is undismissed on every load — it is the subject; the timetable notice on the FIRST
    // load only, so that load is the one where it opens and is dismissed for real.
    await page.addInitScript(() => {
        const n = Number(sessionStorage.getItem('__e2e_ytd_load') || 0) + 1;
        sessionStorage.setItem('__e2e_ytd_load', String(n));
        localStorage.removeItem('myb_notice_ytd_figures_2026_done');
        if (n === 1) localStorage.removeItem('myb_notice_timetable_2026_done');
    });

    // Load 1 — the timetable notice, and nothing behind it, even once it is dismissed. Measured by
    // mutation: deleting the follow rule leaves this GREEN, because the timetable notice's timer fires
    // first and `openNoticeIfClear` then finds the page covered. What this proves is the composed
    // behaviour on a real page; the rule's own teeth are calendar-notices.test.mjs block 7.
    await page.goto('/');
    const timetable = page.locator('#timetableNoticeLb');
    await expect(timetable).toHaveClass(/\bopen\b/, { timeout: 15_000 });
    await page.locator('#timetableNoticeLater').click();
    await expect(timetable).not.toHaveClass(/\bopen\b/);
    expect(await page.evaluate(() => localStorage.getItem('myb_notice_timetable_2026_done')),
        'dismissing it is what lets the next one come').toBe('1');
    await page.waitForTimeout(2500);                       // past the 1,500ms defer, twice over
    await expect(page.locator('#ytdNoticeLb'), 'not on the same load').not.toHaveClass(/\bopen\b/);

    // Load 2 — now it comes, and its link lands on the card, open.
    await page.reload();
    const notice = page.locator('#ytdNoticeLb');
    await expect(notice).toHaveClass(/\bopen\b/, { timeout: 15_000 });
    await expect(notice).toContainText('Taxable Pay');
    await expect(notice).toContainText('Tax Paid');
    await page.locator('#ytdNoticeGo').click();
    await expect(page).toHaveURL(/paycalc\.html#payslipCard$/);
    await expect(page.locator('#payslipCardBody')).toHaveClass(/open/);
    // The seeders re-mark it done on the Pay page's load, so its own flag proves nothing here; the
    // drawer's archive is the store nothing re-seeds.
    const archived = await page.evaluate(() =>
        JSON.parse(localStorage.getItem('myb_app_notices') || '[]').map((/** @type {{ id: string }} */ n) => n.id));
    expect(archived, 'kept in the drawer\'s App Notices once it has been shown').toContain('ytd-figures-2026');
    expect(errors).toHaveLength(0);
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
    // Told what has happened, and not what a page it cannot use does: the "What it does" box goes
    // whole — its heading and guide link with it (paycalc-role-card.js → paintRoleCard).
    await expect(page.locator('#unsupportedGradeAbout')).toBeHidden();
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

// THE £ FIGURE BESIDE ITS LABEL IN THE BACK-PAY STATE — in a BLOCKING lane (test audit, 7 Nov 2026 —
// UI-12). This check lived only in visual.spec.js, an opt-in lane whose CI job is report-only: any
// failure there reads as "baselines drifted" and blocks nothing. So the row that broke on a real phone
// — "Estimated take-home pay (inc. back pay)" wrapping into its own figure, `.sum-row` being
// `space-between` with nothing to keep the two apart — had no guard that could stop a merge. The same
// state and the same sentinels as the visual test, without the picture: the clock is that test's
// (15 Jul 2026) and P55 is the payslip the 2026 award lands on.
//
// TWO THINGS ARE TIGHTER THAN THE VISUAL TEST'S CHECK, because as written there it could not fail
// (measured by deleting each rule): at 390px no label in this state fills its row, so the gap
// between label and figure was the row's slack rather than the `gap: 16px` that keeps them apart; and
// "same line" was `val.top < lbl.bottom`, true of a figure anywhere beside a two-line label. So the
// rows are also measured at 320px, where both labels fill them and the gap rule is all that is left
// between the words and the money; the long back-pay row that actually broke is measured as well as
// the take-home row; and "same line" means the figure's middle lies inside the headline's own line box.
for (const width of [390, 320]) {
    test(`paycalc: with back pay included, each £ sits beside its label and never touches it (${width}px)`, async ({ page }) => {
        await page.clock.setFixedTime(new Date('2026-07-15T09:00:00Z'));
        await page.setViewportSize({ width, height: 1600 });
        await seedSession(page);
        await page.addInitScript(LUMP_QUIET);
        await page.goto('/paycalc.html');
        await expect(page.locator('#netDisplay')).toHaveText(/£\d/);
        await page.locator('#periodSelect').selectOption('55');   // Paid 28 Aug 2026 · P24
        await page.evaluate(() => document.getElementById('backPayHeader')?.click());
        // The include tick lives in the card's paid-in wrap; set it the way its change handler hears it.
        await page.evaluate(() => {
            const t = /** @type {HTMLInputElement|null} */ (document.getElementById('bpIncludeTick'));
            if (t) { t.checked = true; t.dispatchEvent(new Event('change', { bubbles: true })); }
        });
        // Sentinels FIRST, waited for: without the back-pay state there is nothing long enough to break.
        await expect(page.locator('#summary .sum-bp')).toHaveCount(1);
        await expect(page.locator('#summary .sum-net-sub')).toHaveText('includes back pay');
        const geom = await page.evaluate(() => Object.fromEntries(['sum-net', 'sum-bp'].map(cls => {
            const row = /** @type {Element} */ (document.querySelector(`#summary .${cls}`));
            const lblEl = /** @type {Element} */ (row.querySelector('.lbl'));
            const lbl = lblEl.getBoundingClientRect();
            const val = /** @type {Element} */ (row.querySelector('.val')).getBoundingClientRect();
            // The headline's first line box: the label's own words, before the sub-line under them.
            const words = [...lblEl.childNodes].find(n => n.nodeType === Node.TEXT_NODE && (n.textContent || '').trim());
            const range = document.createRange();
            if (words) range.selectNodeContents(words);
            const first = words ? range.getClientRects()[0] : lbl;
            const mid = (val.top + val.bottom) / 2;
            return [cls, { gap: Math.round(val.left - lbl.right), sameLine: mid >= first.top - 0.5 && mid <= first.bottom + 0.5 }];
        })));
        for (const [cls, g] of Object.entries(geom)) {
            expect(g.gap, `.${cls}: the £ figure must never touch the label`).toBeGreaterThan(4);
        }
        // The take-home row only: it alone is aligned to its headline's BASELINE (paycalc.css), so the
        // figure stays on the words it belongs to; every other row centres its figure by design.
        expect(geom['sum-net'].sameLine, 'the take-home £ sits beside the headline\'s first line, not under the sub-line').toBe(true);
    });
}

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

    // AND ONLY ON ITS OWN PAYSLIP (test audit, 7 Nov 2026). Until here this test never left the 28 Aug
    // payslip, so deleting `_bpPNum === _pNum` — which added the whole lump to EVERY payslip of the
    // year while the tick was on — kept it green. The banner has a gate of its own, so it hid on those
    // payslips while the money stayed in the figure. The banner is set in the same calculation as the
    // £, so its hiding is also the sign that the next payslip's figure is the one on screen.
    const paidIn = await page.locator('#periodSelect').inputValue();
    const nextPayslip = String(Number(paidIn) + 1);
    await page.locator('#periodSelect').selectOption(nextPayslip);
    await expect(page.locator('#bpActiveBanner'), 'premise: the next payslip does not carry the lump').toBeHidden();
    const nextWithout = poundsOf(await page.locator('#netDisplay').textContent());
    await page.locator('#periodSelect').selectOption(paidIn);
    await page.locator('#bpBannerTick').check();
    await expect(page.locator('#bpBannerText')).toContainText('✓ Includes');
    await page.locator('#periodSelect').selectOption(nextPayslip);
    await expect(page.locator('#bpActiveBanner')).toBeHidden();
    expect(poundsOf(await page.locator('#netDisplay').textContent()),
        'the lump was added to a payslip that does not carry it').toBe(nextWithout);
    expect(errors, 'Uncaught JS exceptions on the back-pay opt-in').toHaveLength(0);
});

// ── HOURS INSIDE THE AWARD WINDOW MOVE THE LUMP AT ONCE (paycalc-2-2, whole-app check, 10 Nov 2026) ──
// The lump accrues from SAVED hours, and saving hours re-priced everything but it: 20 hours of overtime
// on the 5 Jun payslip left the card on £476.18 until the member moved away and back (£494.93). The
// figure must move on the edit, to exactly what a fresh look gives.
test('paycalc: an hours edit inside the award window re-prices the back-pay lump at once', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.clock.setFixedTime(PAY_2026_27_DAY);
    await seedSession(page);
    await page.addInitScript(LUMP_QUIET);
    await page.goto('/paycalc.html');
    await expect(page.locator('#netDisplay')).toHaveText(/£\d/);
    await page.locator('#periodSelect').selectOption('52');   // 5 Jun 2026 — inside the 2026/27 award window
    await page.evaluate(() => {
        const t = /** @type {HTMLElement} */ (document.getElementById('backPayCardToggle'));
        /** @type {HTMLElement} */ (t.querySelector('.collapse-chevron') || t).click();
    });
    const total = page.locator('#backPayTotalAmt');
    await expect(total).toHaveText(/£\d/);
    const before = await total.textContent();

    await page.fill('#otH', '20');
    await page.dispatchEvent('#otH', 'input');
    await expect(total, 'the overtime is priced into the lump on the edit').not.toHaveText(before ?? '');
    const moved = await total.textContent();
    await page.locator('#periodSelect').selectOption('53');
    await page.locator('#periodSelect').selectOption('52');
    await expect(total, 'and to exactly what a fresh look gives').toHaveText(moved ?? '');
    expect(errors, `fatal errors: ${errors.join(', ')}`).toHaveLength(0);
});

// ── A LUMP TYPED FROM THE PAYSLIP IS NOT AN ESTIMATE TO SHARPEN (whole-app check, 10 Nov 2026) ────
// The banner's second line — "For the best estimate, fill in your hours on each payslip back to
// 1 April …" — is the way to improve a lump WORKED OUT from hours. Typed from the payslip it is the
// payslip's own figure, and hours change nothing, so the line has nothing to say there.
test('paycalc: a back-pay lump typed from the payslip is not told to fill in hours', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.clock.setFixedTime(PAY_2026_27_DAY);   // 7 Nov 2026 — the 28 Aug award payslip is paid
    await seedSession(page);
    await page.addInitScript(LUMP_QUIET);
    await page.goto('/paycalc.html');
    await expect(page.locator('#netDisplay')).toHaveText(/£\d/);
    await page.locator('#periodSelect').selectOption('55');   // Paid 28 Aug 2026 · P24 — carries the 2026/27 award
    await expect(page.locator('#bpActiveBanner')).toBeVisible();
    await expect(page.locator('#bpBannerNote'), 'worked out from hours: the line is the way to sharpen it')
        .toHaveText('For the best estimate, fill in your hours on each payslip back to 1 April 2026.');

    await page.evaluate(() => {
        const t = /** @type {HTMLElement} */ (document.getElementById('backPayCardToggle'));
        /** @type {HTMLElement} */ (t.querySelector('.collapse-chevron') || t).click();
    });
    const worked = (await page.locator('#backPayTotalAmt').textContent() ?? '').replace(/[£,]/g, '').trim();
    expect(Number(worked), 'premise: a lump worked out from hours').toBeGreaterThan(0);
    await page.locator('#bpModeManual').check();
    await page.locator('#bpManualAmt').fill('500.00');
    await expect(page.locator('#bpBannerText')).toContainText('£500.00');
    await expect(page.locator('#bpBannerNote')).toHaveText('');
    await expect(page.locator('#bpBannerNote')).toBeHidden();

    // The SAME figure as the worked-out lump, then back to hours: nothing but the source changes, so
    // only the source can bring the line back.
    await page.locator('#bpManualAmt').fill(worked);
    await expect(page.locator('#bpBannerText')).not.toContainText('£500.00');
    await expect(page.locator('#bpBannerNote')).toHaveText('');
    await page.locator('#bpModeCompute').check();
    await expect(page.locator('#bpBannerNote')).toHaveText(/fill in your hours on each payslip back to 1 April 2026/);
    expect(errors, `fatal errors: ${errors.join(', ')}`).toHaveLength(0);
});

// ── THE TAKE-HOME £ IS THE ENGINE'S OWN FIGURE FOR WHAT IS ON SCREEN (test audit, 7 Nov 2026) ─────
// Every other test in this file checks that the figure MOVES, or that it agrees with itself on a
// second look. None said what it should BE, so `calculate()` could assemble the pieces wrongly with
// every lane green: charging NI on the pay before the pension comes off cost about £12 a payslip and
// failed nothing. `calculate()` cannot be reached from a unit test, so this reads what the page is
// showing — the hours, the tax code — composes it with the pure engine in paycalc-calc.js, and
// requires the page's £ to equal that, to the penny. The rate, the London Allowance and the pension
// come from the tables, not from the page, so a wrong one on screen cannot pass by agreement.
test('paycalc: the take-home £ is the pay engine\'s figure for the payslip on screen', async ({ page }) => {
    const errors = collectFatalErrors(page);
    // The 23 Oct 2026 payslip: after the award, and no bank holiday or Boxing Day in its weeks.
    await page.clock.setFixedTime(new Date('2026-10-21T09:00:00Z'));
    await seedSession(page);
    await seedMember(page);
    await page.addInitScript(LUMP_QUIET);
    await page.goto('/paycalc.html');
    await expect(page.locator('#pensionAmt')).toBeVisible();
    await expect(page.locator('#periodSelect option:checked')).toContainText('23 Oct 2026');

    const TY = /** @type {any} */ (TAX_YEARS.find(t => t.label === '2026/27'));
    const th = getThresholds('2026/27');
    const rate = AWARD_RATES.cea['2026/27'].rate;
    const pension = getPensionForPeriod('cea', new Date(2026, 9, 23, 12));
    /** What the page shows, read in ONE evaluate so a recalculation between two reads cannot split it. */
    const read = () => page.evaluate(() => {
        const v = (/** @type {string} */ id) => (/** @type {HTMLInputElement|null} */ (document.getElementById(id))?.value ?? '').trim();
        const hrs = (/** @type {string} */ h, /** @type {string} */ m) => (parseInt(v(h), 10) || 0) + (parseInt(v(m), 10) || 0) / 60;
        return {
            net: document.getElementById('netDisplay')?.textContent ?? '',
            rate: v('hourlyRate'), pension: v('pensionAmt'), code: v('taxCode'), loan: v('studentLoan'),
            pg: /** @type {HTMLInputElement|null} */ (document.getElementById('pgLoanCheck'))?.checked ?? null,
            adj: v('otherAdj'), ytd: v('ytdPay') + v('ytdTax'),
            sat: hrs('satH', 'satM'), ot: hrs('otH', 'otM'), rdw: hrs('rdwH', 'rdwM'), sun: hrs('sunH', 'sunM'),
            peer: Number(document.getElementById('peerVal')?.textContent || 0),
        };
    });
    /** The engine's take-home for those inputs: gross, the pension taken off first, then tax and NI on what is left. */
    const engine = (/** @type {Awaited<ReturnType<typeof read>>} */ s) => {
        const { gross } = computeGross({ effContr: GRADES.cea.contr, rate, satHrs: s.sat, bhHrs: 0, bhOtHrs: 0,
            oHrs: s.ot, rHrs: s.rdw, sHrs: s.sun, bHrs: 0, peerDays: s.peer, otherAdj: 0, london: TY.londonAllow });
        const sac = Math.max(0, gross - pension);
        return sac - computeTax(sac, s.code, th).tax - computeNI(sac, th.ni);
    };
    // Compared until the roster-assist has filled in this payslip's Saturdays and Sundays — the
    // figure moves when it does, and the inputs are read in the same moment as the figure.
    await expect.poll(async () => { const s = await read(); return Math.abs(Math.round((poundsOf(s.net) - engine(s)) * 100)); },   // pennies apart; abs, as -0 is not 0 to toBe
        'the take-home on screen is not what the pay engine makes of the inputs on screen').toBe(0);

    // The premises the comparison rests on, checked rather than trusted.
    const s = await read();
    expect(poundsOf(s.net), 'premise: a figure was rendered').toBeGreaterThan(0);
    expect(Number(s.rate), 'the hourly rate on screen is the 2026/27 settled rate').toBe(rate);
    expect(s.pension === '' || Number(s.pension) === pension, `the pension on screen (${s.pension}) is this payslip's default`).toBe(true);
    expect([s.loan, s.pg, s.ytd], 'premise: no student loan and no Year to Date figures').toEqual(['none', false, '']);
    expect(s.adj === '' || Number(s.adj) === 0, 'premise: no other adjustment').toBe(true);
    expect(errors, 'Uncaught JS exceptions on the Pay Calculator').toHaveLength(0);
});

// THE LOAN ROWS, THROUGH calculate(). Their words are buildLoanLines' (paycalc-breakdown.js) and are
// pinned in Node; what only the page can show is that calculate() hands it the plan's own label from
// the select and the date of the payslip the deductions stopped on — the wiring, not the rule.
test('paycalc: the loan rows name the plan picked and the payslip deductions stopped on', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.clock.setFixedTime(new Date('2026-11-08T12:00:00'));   // on screen: the 20 Nov payslip (P58)
    await seedSession(page);
    await page.addInitScript(() => {
        localStorage.setItem('myb_pc_ns_migrated', '1');
        localStorage.setItem('myb_pc_gmiller_sl', 'plan4');
        localStorage.setItem('myb_pc_gmiller_sl_paid_off', '57');   // stopped from the 23 Oct payslip
        // 25 Sep, before the stop: a £2,000 correction takes pay well under any loan threshold
        localStorage.setItem('myb_pc_gmiller_p56', JSON.stringify({ otherAdj: -2000 }));
    });
    await page.goto('/paycalc.html');
    const summary = page.locator('#summary');
    await expect(summary).toContainText('Student Loan — not deducted from your 23 Oct payslip onwards');
    await page.evaluate(() => {
        const sel = /** @type {HTMLSelectElement} */ (document.getElementById('periodSelect'));
        for (const o of sel.options) o.selected = o.value === '56';
        sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect(summary).toContainText(
        'Student Loan — no deduction: pay after pension is under the Plan 4 (Scotland) threshold (£2,599.61 per period)');
    expect(errors, 'Uncaught JS exceptions on the Pay Calculator').toHaveLength(0);
});

// THE TWO-TAP CLEAR (the coordinator's `_clearState`). The one destructive control on the page: the
// first tap only ARMS it, with a countdown; three seconds, or a change of payslip, disarms it; only a
// second tap while armed wipes the payslip — and only the one on screen.
test('paycalc: "Clear all entries" needs a second tap, and disarms itself', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.clock.install({ time: new Date('2026-11-08T12:00:00') });   // on screen: the 20 Nov payslip (P58)
    await seedSession(page);
    await page.addInitScript(() => {
        localStorage.setItem('myb_pc_ns_migrated', '1');
        localStorage.setItem('myb_pc_gmiller_p57', JSON.stringify({ satH: 7 }));
        localStorage.setItem('myb_pc_gmiller_p58', JSON.stringify({ satH: 8 }));
    });
    await page.goto('/paycalc.html');
    await expect(page.locator('#satH')).toHaveValue('8');
    await page.clock.pauseAt(new Date('2026-11-08T12:01:00'));
    const btn = page.locator('#clearBtn');
    const saved = (/** @type {number} */ n) => page.evaluate((k) => localStorage.getItem(k), `myb_pc_gmiller_p${n}`);
    const view = (/** @type {number} */ n) => page.evaluate((num) => {
        const sel = /** @type {HTMLSelectElement} */ (document.getElementById('periodSelect'));
        for (const o of sel.options) o.selected = o.value === String(num);
        sel.dispatchEvent(new Event('change', { bubbles: true }));
    }, n);

    await btn.click();
    await expect(btn).toHaveText('Select again to confirm (3)');
    await expect(btn).toHaveClass(/confirming/);
    await page.clock.runFor(1000);
    await expect(btn).toHaveText('Select again to confirm (2)');
    await page.clock.runFor(2000);
    await expect(btn, 'three seconds disarm it').toHaveText('Clear all entries');
    await expect(btn).not.toHaveClass(/confirming/);
    expect(await saved(58), 'nothing was cleared').not.toBeNull();

    await btn.click();
    await view(57);
    await expect(btn, 'a change of payslip disarms it').toHaveText('Clear all entries');
    await btn.click();
    expect(await saved(57), 'one tap on the new payslip only arms it').not.toBeNull();
    // A double-tap is ONE gesture (whole-app review, Nov 2026): the second tap at once is not a
    // confirmation anybody read, and it used to clear the payslip.
    await btn.click();
    expect(await saved(57), 'a tap straight after arming does not confirm').not.toBeNull();
    await expect(btn).toHaveText('Select again to confirm (3)');
    await page.clock.runFor(1000);
    await btn.click();
    await expect(btn).toHaveText('Clear all entries');
    expect(await saved(57), 'the second tap clears the payslip on screen').toBeNull();
    expect(await saved(58), '…and only that one').not.toBeNull();
    await expect(page.locator('#saveStatus')).toHaveText('No entries saved for this period');
    await page.clock.runFor(4000);   // the cleared arm's timers are gone: nothing re-arms or changes
    await expect(btn).toHaveText('Clear all entries');
    expect(errors, 'Uncaught JS exceptions on the Pay Calculator').toHaveLength(0);
});

// THE SETTINGS SUMMARY QUOTES THE RATE THE PAYSLIP WAS PAID AT — periodRate (paycalc-settings.js), the
// answer the rate field shows. They used to work it out separately; before the 28 Aug 2026 award
// payslip it is the earlier rate, and the summary must not quote the new one over it.
test('paycalc: the Settings summary and the rate field agree about the rate a payslip was paid at', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.clock.setFixedTime(new Date('2026-11-08T12:00:00'));
    await seedSession(page);
    await page.addInitScript(() => {
        localStorage.setItem('myb_pc_ns_migrated', '1');
        localStorage.setItem('myb_pc_gmiller_grade', 'cea');
        localStorage.setItem('myb_pc_gmiller_setup', '1');
        localStorage.setItem('myb_pc_gmiller_setup_2026_27', '1');   // the year confirmed, so the summary shows
    });
    await page.goto('/paycalc.html');
    const view = (/** @type {number} */ n) => page.evaluate((num) => {
        const sel = /** @type {HTMLSelectElement} */ (document.getElementById('periodSelect'));
        for (const o of sel.options) o.selected = o.value === String(num);
        sel.dispatchEvent(new Event('change', { bubbles: true }));
    }, n);
    const award = AWARD_RATES.cea['2026/27'];
    expect(award.pre, 'premise: the year has a rate before its award').not.toBe(award.rate);
    await view(54);   // paid 31 Jul 2026
    await expect(page.locator('#settingsHint')).toHaveText(`✓ 2026/27 — £${award.pre.toFixed(2)}/hr · pre-rise`);
    await expect(page.locator('#hourlyRate')).toHaveValue(award.pre.toFixed(2));
    await view(55);   // paid 28 Aug 2026, the award payslip
    await expect(page.locator('#settingsHint')).toHaveText(`✓ 2026/27 — £${award.rate.toFixed(2)}/hr`);
    await expect(page.locator('#hourlyRate')).toHaveValue(award.rate.toFixed(2));
    expect(errors, 'Uncaught JS exceptions on the Pay Calculator').toHaveLength(0);
});

// ── A YEAR NOT YET CHECKED, IN A MEMBER'S FIRST SESSION (whole-app review, Nov 2026) ──────────────
// Grade, tax code, loan and pension are single settings used for every payslip; only the "checked"
// mark is per tax year. The banner said they "apply to 2025/26 only", the card opened announcing a
// "New tax year 2025/26" that had ended, and the header kept the checked year's "✓ … £21.49/hr" over
// a payslip priced at £20.74. Here 2026/27 is checked and 2025/26 is not (the state after a first
// Save, before the one-time sweep of a later load marks the older years).
test('paycalc: stepping back to a year not yet checked says what is true, and no "New tax year" for one that is over', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.clock.setFixedTime(new Date('2026-11-08T12:00:00'));
    await seedSession(page);
    await page.addInitScript(() => {
        localStorage.setItem('myb_pc_ns_migrated', '1');
        localStorage.setItem('myb_pc_gmiller_grade', 'cea');
        localStorage.setItem('myb_pc_gmiller_setup', '1');
        localStorage.setItem('myb_pc_gmiller_setup_2026_27', '1');
        localStorage.setItem('myb_pc_gmiller_setup_years_migrated', '1');
    });
    await page.goto('/paycalc.html');
    const view = (/** @type {number} */ n) => page.evaluate((num) => {
        const sel = /** @type {HTMLSelectElement} */ (document.getElementById('periodSelect'));
        for (const o of sel.options) o.selected = o.value === String(num);
        sel.dispatchEvent(new Event('change', { bubbles: true }));
    }, n);
    await expect(page.locator('#settingsHint')).toHaveText(/^✓ 2026\/27 — £/);
    await view(47);   // paid 16 Jan 2026 — 2025/26, after its award
    await expect(page.locator('#setupBanner')).toBeVisible();
    await expect(page.locator('#setupBannerBody')).toContainText('Your settings apply to every payslip');
    await expect(page.locator('#setupBannerBody')).not.toContainText('only');
    await expect(page.locator('#settingsHint'), 'no ✓ over a year not yet checked').toHaveText('Check once per tax year — pension saves per payslip');
    await expect(page.locator('#settingsNewYearNotice'), 'a year that is over is not a new one').toBeHidden();
    await view(58);
    await expect(page.locator('#settingsHint')).toHaveText(/^✓ 2026\/27 — £/);
    expect(errors, 'Uncaught JS exceptions on the Pay Calculator').toHaveLength(0);
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
    // Confirmed, so not hedged: the figure was copied off this payslip (whole-app check, 10 Nov 2026).
    await expect(page.locator('#hppBannerText')).toContainText('Your Holiday Pay Premium of £1,843.01 is on this payslip');
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
    // The two boxes are in the Year to Date card, which starts closed — and a closed card's fields
    // are out of reach, for this test as for a member (paycalc.css → `.collapsible-body`).
    await page.locator('#payslipCardToggle .card-toggle-arrow').click();

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
// A Tax Paid typed one digit short (348 for 3,480) asked for nearly a year's tax at once. Bounded by the
// pay alone, the tax took all of it and NI came off on top: a negative take-home (whole-app review,
// Nov 2026). This pins calculate() handing NI and loans to computeTax, and the summary saying why.
test('paycalc: a mistyped Tax Paid never makes the take-home negative, and the summary says to check it', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.clock.setFixedTime(new Date('2026-11-07T09:00:00Z'));
    await seedSession(page);
    await seedMember(page);
    await page.addInitScript(() => {
        localStorage.setItem('myb_pc_ns_migrated', '1');
        localStorage.setItem('myb_pc_ytd_notice_2_shown', '1');
        localStorage.setItem('myb_pc_gmiller_sl', 'plan2');
        localStorage.setItem('myb_pc_gmiller_ytd_src_2026_27', '57');
        localStorage.setItem('myb_pc_gmiller_ytd_pay_2026_27', '25142.72');
        localStorage.setItem('myb_pc_gmiller_ytd_tax_2026_27', '348');
    });
    await page.goto('/paycalc.html');
    await expect(page.locator('#pensionAmt')).toBeVisible();
    await page.locator('#periodSelect').selectOption('58');
    await expect(page.locator('#summary')).toContainText('ask for more tax than this payslip pays');
    const net = await page.locator('#netDisplay').textContent();
    expect(poundsOf(net), `the take-home reads ${net}`).toBeGreaterThanOrEqual(0);
    expect(net ?? '', 'no minus sign on the take-home').not.toMatch(/[−-]/);
    expect(errors).toHaveLength(0);
});

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

// ── THE YEAR TO DATE LINE UNDER THE TAKE-HOME £ (owner, 7 Nov 2026) ─────────────────────────────
// The figures change on every payslip, so the result card asks for the latest ones wherever they
// would sharpen the estimate on screen. The rule is unit-tested (paycalc-periods.test.mjs →
// ytdUpdateFrom); these pin the wiring: calculate() writing the line on every run, the date it
// names, the button, and the line going once the figures are in. On 7 Nov 2026 the 23 Oct payslip
// (internal 57) is the latest paid, 20 Nov (58) is next, and 18 Dec (59) is not yet out.
test('paycalc: the take-home asks for the latest Year to Date figures, and stops once they are in', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.clock.setFixedTime(new Date('2026-11-07T09:00:00Z'));
    await seedSession(page);
    await seedMember(page);
    await page.addInitScript(() => {
        localStorage.setItem('myb_pc_ns_migrated', '1');
        localStorage.setItem('myb_pc_ytd_notice_2_shown', '1');
    });
    await page.goto('/paycalc.html');
    await expect(page.locator('#pensionAmt')).toBeVisible();
    await page.locator('#periodSelect').selectOption('58');

    const line = page.locator('#netYtdNudge');
    await expect(line).toBeVisible();
    await expect(line).toContainText('copy the Year to Date figures from your 23 Oct payslip');

    // The button opens the card, brings it into view and puts the cursor in the first box.
    await expect(page.locator('#payslipCardBody')).not.toHaveClass(/\bopen\b/);
    await page.locator('#netYtdNudgeBtn').click();
    await expect(page.locator('#payslipCardBody')).toHaveClass(/\bopen\b/);
    await expect(page.locator('#ytdPay')).toBeFocused();
    await expect(page.locator('#payslipCard')).toBeInViewport();

    // One figure is not a pair: the estimate cannot use it yet, so the line stays — and the card's chip
    // says so too, from what computeTax did rather than from "a box has text" (whole-app review).
    await page.fill('#ytdPay', '13200');
    await page.dispatchEvent('#ytdPay', 'input');
    await expect(line).toBeVisible();
    await expect(page.locator('#ytdStatusChip')).toHaveText('not in use');
    await expect(page.locator('#ytdUptoNote')).toContainText('fill in both Taxable Pay and Tax Paid');
    // Both figures, stamped to the 23 Oct payslip: in use, so the line goes.
    await page.fill('#ytdTax', '1650');
    await page.dispatchEvent('#ytdTax', 'input');
    await expect(page.locator('#ytdSrcSelect')).toHaveValue('57');
    await expect(page.locator('#ytdStatusChip')).toHaveText('✓ in use');
    await expect(line).toBeHidden();

    // Quiet on a payslip already paid, and on one whose previous payslip is not out yet.
    await page.locator('#periodSelect').selectOption('57');
    await expect(page.locator('#netPeriod')).toContainText('23 Oct');
    await expect(line).toBeHidden();
    await page.locator('#periodSelect').selectOption('59');
    await expect(page.locator('#netPeriod')).toContainText('18 Dec');
    await expect(line).toBeHidden();
    expect(errors, 'Uncaught JS exceptions on the Year to Date line').toHaveLength(0);
});

test('paycalc: Year to Date figures from an older payslip are asked for again', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.clock.setFixedTime(new Date('2026-11-07T09:00:00Z'));
    await seedSession(page);
    await seedMember(page);
    await page.addInitScript(() => {
        localStorage.setItem('myb_pc_ns_migrated', '1');
        localStorage.setItem('myb_pc_ytd_notice_2_shown', '1');
        localStorage.setItem('myb_pc_gmiller_ytd_src_2026_27', '56');   // the 25 Sep payslip
        localStorage.setItem('myb_pc_gmiller_ytd_pay_2026_27', '11000');
        localStorage.setItem('myb_pc_gmiller_ytd_tax_2026_27', '1400');
    });
    await page.goto('/paycalc.html');
    await expect(page.locator('#pensionAmt')).toBeVisible();
    await page.locator('#periodSelect').selectOption('58');
    await expect(page.locator('#ytdStatusChip')).toHaveText('not in use');
    await expect(page.locator('#netYtdNudge')).toBeVisible();
    await expect(page.locator('#netYtdNudge')).toContainText('from your 23 Oct payslip');

    // Doing what it asks MOVES the source (whole-app review, Nov 2026): the figures were stamped on
    // first entry only, so re-typed ones stayed on 25 Sep — the line kept asking, and the 23 Oct
    // payslip, straight after that old source, counted its own pay twice.
    await page.locator('#netYtdNudgeBtn').click();
    await page.fill('#ytdPay', '14300');
    await page.dispatchEvent('#ytdPay', 'input');
    await page.fill('#ytdTax', '1840');
    await page.dispatchEvent('#ytdTax', 'input');
    await expect(page.locator('#ytdSrcSelect')).toHaveValue('57');
    await expect(page.locator('#ytdStatusChip')).toHaveText('✓ in use');
    await expect(page.locator('#ytdUptoNote')).toContainText('from your 23 Oct payslip');
    await expect(page.locator('#netYtdNudge')).toBeHidden();
    await page.locator('#periodSelect').selectOption('57');
    await expect(page.locator('#netPeriod')).toContainText('23 Oct');
    await expect(page.locator('#ytdStatusChip'), 'the 23 Oct payslip no longer counts its own pay twice').toHaveText('not in use');
    expect(errors).toHaveLength(0);
});

// …but ONLY over figures already recorded (whole-app check, 10 Nov 2026 — the move above first fired
// on any typing). Figures typed into empty boxes against a payslip already recorded, or after the
// member picked one in the select, come from the payslip they chose; moving it lost that choice, and
// for a joiner it priced a June figure as October's (the ytd-mode HPP test went to £0).
test('paycalc: Year to Date figures typed against a payslip the member chose keep it', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.clock.setFixedTime(new Date('2026-11-07T09:00:00Z'));
    await seedSession(page);
    await seedMember(page);
    await page.addInitScript(() => {
        localStorage.setItem('myb_pc_ns_migrated', '1');
        localStorage.setItem('myb_pc_ytd_notice_2_shown', '1');
        localStorage.setItem('myb_pc_gmiller_ytd_src_2026_27', '56');   // the 25 Sep payslip — no figures yet
    });
    await page.goto('/paycalc.html');
    await expect(page.locator('#pensionAmt')).toBeVisible();
    await page.locator('#periodSelect').selectOption('58');
    await page.locator('#payslipCardToggle .card-toggle-arrow').click();

    // Into the empty boxes — both, which are one edit: the payslip already recorded stands.
    await page.fill('#ytdPay', '11000');
    await page.dispatchEvent('#ytdPay', 'input');
    await page.fill('#ytdTax', '1400');
    await page.dispatchEvent('#ytdTax', 'input');
    await expect(page.locator('#ytdSrcSelect')).toHaveValue('56');

    // A new edit over those figures — the boxes are left first, as picking in the sheet leaves them —
    // after picking a payslip in the select: the pick stands.
    await page.locator('#ytdTax').blur();
    await page.locator('#ytdSrcSelect').selectOption('55', { force: true });
    await page.locator('#ytdSrcSelect').dispatchEvent('change');
    await page.fill('#ytdPay', '9000');
    await page.dispatchEvent('#ytdPay', 'input');
    await expect(page.locator('#ytdSrcSelect')).toHaveValue('55');
    expect(errors).toHaveLength(0);
});

// A week 1 / month 1 code never uses the figures, and the card said "✓ in use" over it all the same
// (whole-app review, Nov 2026). The code is a setting, not a Year to Date box — so this pins that the
// chip is written by calculate() from computeTax's own answer, on every recalculation.
test('paycalc: under a week 1 / month 1 tax code the Year to Date card says its figures are not in use', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.clock.setFixedTime(new Date('2026-11-07T09:00:00Z'));
    await seedSession(page);
    await seedMember(page);
    await page.addInitScript(() => {
        localStorage.setItem('myb_pc_ns_migrated', '1');
        localStorage.setItem('myb_pc_ytd_notice_2_shown', '1');
        localStorage.setItem('myb_pc_gmiller_ytd_src_2026_27', '57');
        localStorage.setItem('myb_pc_gmiller_ytd_pay_2026_27', '13200');
        localStorage.setItem('myb_pc_gmiller_ytd_tax_2026_27', '1650');
    });
    await page.goto('/paycalc.html');
    await expect(page.locator('#pensionAmt')).toBeVisible();
    await page.locator('#periodSelect').selectOption('58');
    await expect(page.locator('#ytdStatusChip')).toHaveText('✓ in use');
    await page.locator('#taxCode').fill('1257L M1');
    await expect(page.locator('#ytdStatusChip')).toHaveText('not in use');
    await expect(page.locator('#ytdUptoNote')).toContainText('a tax code ending in W1, M1 or X works out each payslip on its own');
    await page.locator('#taxCode').fill('1257L');
    await expect(page.locator('#ytdStatusChip')).toHaveText('✓ in use');
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
    // Opened first: a closed card's fields are out of reach (paycalc.css → `.collapsible-body`).
    await page.locator('#payslipCardToggle .card-toggle-arrow').click();
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

    const card = page.locator('#unsupportedGradeBanner');
    await expect(card).toBeVisible();
    // Written FOR a Dispatcher (v25.50, paycalc-role-card.js): their pay is not covered YET, and the
    // condition for adding it is the rates — "we haven't got them" is the truth, and it tells a
    // Dispatcher this is a gap rather than a decision. No date: the condition is information.
    await expect(page.locator('#unsupportedGradeTitle')).toHaveText("The Pay Calculator doesn't cover Dispatcher pay yet");
    await expect(card).toContainText('once Dispatcher rates are confirmed');
    // ...it says what the calculator DOES, naming the grades it serves in full...
    await expect(page.locator('#unsupportedGradeWhat')).toContainText("Customer Experience Ambassador's or Supervisor's (CEA or CES)");
    // ...and links the guide, which is the only "what is this for" left on a refusal: the page's own
    // guide link is hidden with the calculator.
    await expect(card.locator('a[href="./paycalc-guide.html"]')).toBeVisible();
    await expect(page.locator('main > .guide-footer-link')).toBeHidden();
    // ONE DOOR: the refusal wears the sign-in card's panel, so on a wide screen it is centred over the
    // page as that card is — not parked in the work columns the calculator would have used (v25.50).
    const [cardBox, mainBox] = await Promise.all([card.boundingBox(), page.locator('main').boundingBox()]);
    expect(cardBox && mainBox && Math.abs((cardBox.x + cardBox.width / 2) - (mainBox.x + mainBox.width / 2)),
        'the refusal card is centred on the page').toBeLessThan(2);
    // ...at the sign-in card's width (a box dropped from the shared panel recipe is full-width, and
    // a full-width box is centred too — so the centre alone cannot tell the two apart).
    const standard = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--modal-standard')));
    expect(cardBox?.width, 'the refusal card is the sign-in card\'s width').toBeCloseTo(standard, 0);
    // WITHHELD, not captioned — the form's whole output is one confident £ figure, and a member
    // told "this may not apply" and then handed one will use it.
    await expect(page.locator('.pc-work')).toBeHidden();
    await expect(page.locator('.pc-side')).toBeHidden();
    // ...and it is a refusal with a way out, not a dead end — the sign-in card's own.
    await expect(page.locator('#navMenuBtn')).toBeVisible();
    await expect(card.locator('a.login-back')).toHaveAttribute('href', './');
    expect(errors, 'Uncaught JS exceptions on the unsupported-role gate').toHaveLength(0);
});

// A MANAGER is refused the same way and told something different (owner, 7 Nov 2026): who the
// calculator is FOR, and why they might point their team at it. Not "yet", not "will be added" —
// managers are not in line for it, so either would be untrue to this reader. D. Watts is a
// Management row: hidden from every picker, but a manager signs in all the same.
test('paycalc: a manager is told who the calculator is for — with nothing promised — and shown no figure', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await seedSession(page, 'D. Watts');
    await page.goto('/paycalc.html');

    const card = page.locator('#unsupportedGradeBanner');
    await expect(card).toBeVisible();
    await expect(page.locator('#unsupportedGradeTitle')).toHaveText('The Pay Calculator is for CEAs and CESs');
    await expect(card).toContainText('someone in your team');
    await expect(card).not.toContainText('will be added');
    await expect(card).not.toContainText('Dispatcher');
    await expect(card.locator('a[href="./paycalc-guide.html"]')).toBeVisible();
    await expect(page.locator('.pc-work')).toBeHidden();
    await expect(page.locator('.pc-side')).toBeHidden();
    expect(errors, 'Uncaught JS exceptions on the manager card').toHaveLength(0);
});

// THE SIGN-IN CARD EXPLAINS THE PAGE (v25.50). A visitor with no named session — a member whose
// session lapsed, or the shared staff PIN, which carries no name — met a bare "Pay Calculator · Sign
// in" with nothing to say what it was or who it was for. The PIN line is worded for everybody rather
// than shown on detection: this page signs the PIN out moments after it arrives, by design.
test('paycalc: the sign-in card says what the calculator is, who it is for, and that the staff PIN does not open it', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.goto('/paycalc.html');
    const about = page.locator('#loginAbout');
    await expect(about).toBeVisible();
    await expect(about).toContainText('Customer Experience Ambassadors and Supervisors (CEA and CES)');
    await expect(about).toContainText("the staff PIN doesn't open it");
    await expect(about.locator('a.login-about-link')).toHaveAttribute('href', './paycalc-guide.html');
    await expect(page.locator('#loginFootnote')).toContainText('shared screen');
    // The words DESCRIBE the dialog, so a screen reader announces them with the card.
    await expect(page.locator('#loginOverlay')).toHaveAttribute('aria-describedby', 'loginAbout');
    // The explanation sits ABOVE the form, so it is read before the fields it explains.
    const [aboutBox, fieldBox] = await Promise.all([about.boundingBox(), page.locator('#loginCard .login-field').first().boundingBox()]);
    expect(aboutBox && fieldBox && aboutBox.y + aboutBox.height <= fieldBox.y, 'the explanation is above the first field').toBe(true);
    expect(errors, 'Uncaught JS exceptions on the explained sign-in card').toHaveLength(0);
});

// ...and only on this page: every other page's sign-in card is exactly what it was.
test('the sign-in explanation is the Pay Calculator\'s alone — another page\'s card is unchanged', async ({ page }) => {
    await page.goto('/settings.html');
    await expect(page.locator('#loginOverlay')).toBeVisible();
    await expect(page.locator('#loginAbout')).toHaveCount(0);
    await expect(page.locator('#loginFootnote')).toHaveCount(0);
    expect(await page.locator('#loginOverlay').getAttribute('aria-describedby')).toBeNull();
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

// Before the 24 Oct 2025 award a CES was paid at a rate that is not on record (AWARD_RATES
// `pre: null`), so the estimate prices those periods at the later one — and must SAY so, never call
// it the "current rate" (whole-app review, Oct 2026; paycalc.md invariant 1).
test('paycalc: a CES period before the 2025 award says the rate before it is not on record', async ({ page }) => {
    const member = 'F. Mohamed';   // the CES row of the grade test above
    await page.clock.setFixedTime(new Date('2026-10-22T09:00:00Z'));
    await seedSession(page, member);
    await page.addInitScript(() => { localStorage.setItem('myb_pc_ns_migrated', '1'); });
    await page.goto('/paycalc.html?payday=2025-07-04');
    await expect(page.locator('#rateYearLabel')).toContainText('post-rise rate');
    await expect(page.locator('#rateStepNote')).toContainText("isn't on record");
    await page.goto('/paycalc.html?payday=2025-11-21');
    await expect(page.locator('#rateYearLabel')).toContainText('current rate');
    await expect(page.locator('#rateStepNote')).toBeHidden();
});

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

// THE SAME CLEAR, WHEN NOTHING ELSE IS SPECIAL ON THE PAYSLIP (whole-app review, Nov 2026). The test
// above passes because period 56 holds other special-rate days for its member, which keep the card on
// screen. For a fixed Monday–Friday line whose one bank holiday became leave, the calendar's answer is
// "nothing at all": getRosterSuggestion returned null, the card hid, and Replace returned before its
// clear — so the stale 7h stayed in the estimate, the HPP figure and the year totals.
test('paycalc: Replace clears stale hours even when the calendar has nothing else special', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.clock.setFixedTime(new Date('2026-07-15T09:00:00Z'));
    await seedSession(page, 'C. Reen');
    await seedMember(page, 'C. Reen');
    await page.addInitScript(() => {
        const w = /** @type {any} */ (window); w.__E2E = w.__E2E || {};
        // Her rostered Summer bank holiday (Mon 31 Aug 2026), booked as leave.
        w.__E2E.docs = [{ id: 'bh-al', memberName: 'C. Reen', date: '2026-08-31', type: 'annual_leave', value: 'AL', note: '' }];
    });
    await page.goto('/paycalc.html');
    await page.locator('#periodSelect').selectOption('56');
    await expect(page.locator('#bhH')).toBeVisible();
    await page.locator('#bhH').fill('7');
    await expect(page.locator('#rosterHintBar'), 'the card must stay on screen while there is something to clear').toBeVisible();
    await expect(page.locator('#rosterRows')).toContainText('no Saturday, Sunday or bank holiday shifts');
    await expect(page.locator('#fillFromRosterBtn')).toHaveText('Replace with calendar values');
    await page.locator('#fillFromRosterBtn').click();
    await expect(page.locator('#rosterHintText')).toContainText(/Cleared Bank holiday/);
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

// The same card at 360px with the LONGEST label (the test above uses RDW, the shortest of the seven).
// A "Bank holiday overtime" row whose hours differ needed ~56px more than the row had: nothing in it
// could wrap, so the meta column was crushed to 0px and "Calendar: 8h 30m" and its chip painted over
// the arrow and out of the row. An rdw change on the 31 Aug 2026 bank holiday makes that row.
// Fitting is not enough on its own: a row that fits by SQUEEZING (the label broken over two lines,
// the meta a narrow stack) or by letting the arrow wrap to a line of its own is the same defect drawn
// differently. So the label keeps its one line and the arrow its place at the right edge, centred.
test('paycalc: the calendar rows fit a 360px phone when the hours differ, longest label included', async ({ page }, info) => {
    test.skip(!isTouchProject(info), 'a narrow phone');
    await page.setViewportSize({ width: 360, height: 800 });
    await page.clock.setFixedTime(new Date('2026-09-02T09:00:00Z'));
    await seedSession(page);
    await seedMember(page);
    await page.addInitScript(() => {
        localStorage.setItem('myb_pc_ns_migrated', '1');
        const w = /** @type {any} */ (window); w.__E2E = w.__E2E || {};
        w.__E2E.docs = [{ id: 'b1', memberName: 'G. Miller', date: '2026-08-31', type: 'rdw', value: '06:00-14:30', source: 'manual' }];
    });
    await page.goto('/paycalc.html?payday=2026-09-18');
    await expect(page.locator('.roster-row[data-cat="bhOt"]')).toBeVisible({ timeout: 10000 });
    for (const cat of await page.locator('.roster-row').evaluateAll(els => els.map(e => e.getAttribute('data-cat')))) {
        await page.locator(`#${cat}H`).fill('16');
        await page.locator(`#${cat}M`).fill('30');
    }
    await expect(page.locator('.roster-row:not(.roster-row--differs)')).toHaveCount(0);
    const rows = await page.locator('.roster-row').evaluateAll(els => els.map(row => {
        const r = row.getBoundingClientRect();
        const out = [...row.children].filter(c => c.getClientRects().length && !c.classList.contains('visually-hidden'))
            .filter(c => { const b = c.getBoundingClientRect(); return b.left < r.left - 0.5 || b.right > r.right + 0.5; })
            .map(c => c.className);
        const meta = /** @type {HTMLElement} */ (row.querySelector('.roster-row-meta'));
        const label = document.createRange();
        label.selectNodeContents(/** @type {Element} */ (row.querySelector('.roster-row-label')));
        const arrow = /** @type {Element} */ (row.querySelector('.roster-cat-arrow, .roster-cat-match')).getBoundingClientRect();
        return { cat: row.getAttribute('data-cat'), overflow: row.scrollWidth - row.clientWidth, out,
                 metaSqueezed: meta.scrollWidth - meta.clientWidth,
                 labelLines: new Set([...label.getClientRects()].map(l => Math.round(l.top))).size,
                 arrowFromRight: r.right - arrow.right,
                 arrowOffCentre: Math.abs((arrow.top + arrow.bottom) / 2 - (r.top + r.bottom) / 2) };
    }));
    expect(rows.map(r => r.cat), 'the premise: the longest label is among them').toContain('bhOt');
    for (const r of rows) {
        const { cat, overflow, out, metaSqueezed, labelLines } = r;
        expect({ cat, overflow, out, metaSqueezed, labelLines }, `the ${cat} row`)
            .toEqual({ cat, overflow: 0, out: [], metaSqueezed: 0, labelLines: 1 });
        // 11px = the row's 1px border + the arrow's 10px inset.
        expect(r.arrowFromRight, `the ${cat} row's arrow sits at its right edge`).toBeCloseTo(11, 0);
        expect(r.arrowOffCentre, `the ${cat} row's arrow is centred on the row`).toBeLessThanOrEqual(1);
    }
});

// ── THE STYLESHEET, READ LINE BY LINE (whole-app check, 10 Nov 2026) ─────────────────────────────
// paycalc.css findings that only a rendered page shows: each test measures what a member sees.

/** A CSS colour expression as this page computes it, for comparing with a computed colour.
 *  @param {import('@playwright/test').Page} page @param {string} value */
const pcColour = (page, value) => page.evaluate((v) => {
    const i = document.createElement('i'); i.style.color = v; document.body.append(i);
    const c = getComputedStyle(i).color; i.remove(); return c;
}, value);

test('paycalc: a Tab stop on a dark surface wears the ring drawn for one', async ({ page }, info) => {
    // The help sheet's ✕ and the guide link at the foot of the page have no focus rule of their own,
    // so they took the app's navy fallback ring: 1.17:1 on the dark glass and 1:1 on the navy canvas.
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
    await expect(page.locator('#helpLightbox.visible')).toBeVisible();
    const close = page.locator('#helpLightboxClose');
    for (let i = 0; i < 6 && !(await close.evaluate(e => e === document.activeElement)); i++) await page.keyboard.press('Tab');
    expect(await ring(close), 'the help sheet\'s ✕ on the dark glass').toEqual({ focus: true, style: 'solid', colour: gold });
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
    // Rows 1 and 2 of the desktop grid belong to the setup banner and the first-visit privacy note,
    // and an empty grid row still takes its row-gap. Only the note's was taken back, so a RETURNING
    // member — both hidden, the normal state — had the workspace 20px under the header against the
    // 4px of every other card page (pages.spec.js measures the first visit only, where both show).
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
            const shown = ['#setupBanner', '#privacyNoteTop', '.pc-work > :first-child']
                .map(s => /** @type {HTMLElement} */ (document.querySelector(s)))
                .filter(el => el.getClientRects().length)
                .map(el => el.getBoundingClientRect());
            return { top: Math.round(shown[0].top - header),
                     steps: shown.slice(1).map((r, i) => Math.round(r.top - shown[i].bottom)) };
        });
        expect(m.top, `${name}: the first block sits 4px under the header`).toBe(4);
        expect(m.steps.every(s => s === 16), `${name}: one 16px gap between the blocks, measured ${JSON.stringify(m.steps)}`).toBe(true);
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
    // inherited size is scaled once (`scaleText` in helpers.js compounds them).
    const scale = () => page.evaluate(() => {
        const all = /** @type {[HTMLElement, number][]} */ ([...document.querySelectorAll('*')].map(el => [el, parseFloat(getComputedStyle(el).fontSize)]));
        for (const [el, px] of all) if (px) el.style.fontSize = (px * 1.6) + 'px';
    });
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
    // sheet: "Yes, it's mine" 280px wide over a 290px "No — start fresh", the mismatched pair the
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
        expect(mine, `${width}px: "Yes, it's mine" against "No — start fresh" under it`).toEqual(fresh);

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
    expect(mine, '"Yes, it\'s mine" against "No — start fresh"').toBe(fresh);
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

// ── THE IPHONE AUDIT (7 Nov 2026) ─────────────────────────────────────────────────────────────────
// Each block below is one finding, proved where a member meets it: the page, not the helper.

// The converter was the one figure box still read with a bare parseFloat, so "7,5" from a
// decimal-comma keypad answered "7 hrs". The rule is unit-tested (`decimalHoursText`,
// paycalc-inputs.test.mjs); this proves the card asks it.
test('paycalc: the Decimal Hours Converter reads a decimal comma as the point', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await seedSession(page);
    await page.addInitScript(PT_QUIET);
    await page.goto('/paycalc.html');
    await page.locator('#decimalConverterToggle').click();
    const box = page.locator('#decimalHrsInput');
    const answer = page.locator('#decimalHrsResult');
    await box.fill('7,5');
    await expect(answer).toHaveText('7 hrs 30 mins');
    // Only what it can read whole (whole-app check, 10 Nov 2026): these answered "7 hrs" and "1000 hrs".
    await box.fill('7:30');
    await expect(answer, 'a clock time is already hours and minutes').toHaveText('7 hrs 30 mins');
    await box.fill('1e3');
    await expect(answer).toHaveText('–');
    await box.fill('');
    await expect(answer, 'a cleared box asks nothing, so answers nothing').toHaveText('–');
    expect(errors).toHaveLength(0);
});

// A desk keyboard can type a clock time into an hours box; parseInt stopped at the colon, so "7:30" was
// priced and SAVED as 7h while the box still read 7:30 (whole-app review, Nov 2026). The reading is
// unit-tested (`hoursTextToHM`); this proves the price, the save and the blur split all use it.
test('paycalc: "7:30" in an hours box is seven and a half hours — priced, saved and split', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.clock.setFixedTime(new Date('2026-11-07T09:00:00Z'));
    await seedSession(page);
    await page.addInitScript(() => { localStorage.setItem('myb_pc_ns_migrated', '1'); });
    await page.goto('/paycalc.html');
    await expect(page.locator('#pensionAmt')).toBeVisible();
    const pNum = await page.locator('#periodSelect').inputValue();
    await page.locator('#otH').fill('7:30');
    await expect(page.locator('#otH').locator('xpath=ancestor::div[contains(@class,"hhmm-wrap")]/..').locator('.hhmm-dec-hint'))
        .toHaveText('= 7h 30m');
    const saved = await page.evaluate((n) => JSON.parse(localStorage.getItem(`myb_pc_gmiller_p${n}`) ?? 'null'), pNum);
    expect([saved?.otH, saved?.otM], 'saved as typed means, before the box is left').toEqual([7, 30]);
    await page.locator('#otH').blur();
    await expect(page.locator('#otH')).toHaveValue('7');
    await expect(page.locator('#otM')).toHaveValue('30');
    expect(errors).toHaveLength(0);
});

// "Download backup" said "Saved as …" the instant the tap landed — before iOS had saved anything —
// and a blob download in the Home Screen app may open a preview rather than save. On an iPhone it now
// opens the share sheet (Save to Files, in a tab and in the installed app), IN the tap, and reports
// how the sheet ended; everywhere else it stays a download, worded as what to expect. The platform is
// set per test rather than taken from the project, so both branches run on both engines.
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
/** A device that CAN share files, recording each share and ending it as `__shareEnds` says. */
const fakeShareDevice = (/** @type {import('@playwright/test').Page} */ page, /** @type {string} */ ua) => page.addInitScript((agent) => {
    const w = /** @type {any} */ (window);
    Object.defineProperty(navigator, 'userAgent', { configurable: true, get: () => agent });
    Object.defineProperty(navigator, 'platform', { configurable: true, get: () => (agent.includes('iPhone') ? 'iPhone' : 'Linux armv8l') });
    w.__shares = [];
    w.__shareEnds = 'resolve';
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: (/** @type {any} */ d) => !!d?.files?.length });
    Object.defineProperty(navigator, 'share', { configurable: true, value: (/** @type {any} */ d) => {
        w.__shares.push(d.files.map((/** @type {File} */ f) => f.name));
        return w.__shareEnds === 'abort' ? Promise.reject(new DOMException('cancelled', 'AbortError')) : Promise.resolve();
    } });
    // IN THE TAP: a listener on the document runs AFTER the button's own handler, in the same
    // dispatch. A share recorded by then was started inside the tap; one deferred to a later task —
    // an awaited file read, a timer — was not, and iOS refuses it for want of a gesture. (A microtask
    // also runs before this listener, because the browser checkpoints them between listeners, so this
    // cannot tell one from a synchronous call; the handler makes the call synchronously anyway.)
    document.addEventListener('click', (e) => {
        if (/** @type {Element} */ (e.target)?.id === 'ptDownload') w.__sharedInTap = w.__shares.length;
    });
}, ua);

test('paycalc: on an iPhone, Download backup opens the share sheet in the tap and says how it ended', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await seedSession(page);
    await page.addInitScript(PT_QUIET);
    await page.addInitScript(() => localStorage.setItem('myb_pc_gmiller_p16', '{"satH":7,"satM":30}'));
    await fakeShareDevice(page, IPHONE_UA);
    let downloads = 0;
    page.on('download', () => { downloads++; });
    await page.goto('/paycalc.html#payTransferCard');
    await expect(page.locator('#payTransferBody')).toHaveClass(/open/);
    const status = page.locator('#ptSaveStatus');

    await page.locator('#ptDownload').click();
    await expect(status).toContainText('If you chose Save to Files, look for');
    await expect(status).toContainText('in the Files app');
    expect(await page.evaluate(() => /** @type {any} */ (window).__sharedInTap),
        'navigator.share must be called inside the tap, or iOS refuses it for want of a gesture').toBe(1);
    expect(await page.evaluate(() => /** @type {any} */ (window).__shares[0][0])).toMatch(/^myb-pay-backup-gmiller-\d{4}-\d{2}-\d{2}\.json$/);

    // Closing the sheet saves nothing, and the card must not say otherwise.
    await page.evaluate(() => { /** @type {any} */ (window).__shareEnds = 'abort'; });
    await page.locator('#ptDownload').click();
    await expect(status).toContainText('Not saved');
    await expect(status).toHaveClass(/pt-status--warn/);
    expect(downloads, 'an iPhone that can share files gets the share sheet, never a blob download').toBe(0);
    expect(errors).toHaveLength(0);
});

test('paycalc: away from an iPhone, Download backup stays a download and says what to expect', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await seedSession(page);
    await page.addInitScript(PT_QUIET);
    await page.addInitScript(() => localStorage.setItem('myb_pc_gmiller_p16', '{"satH":7,"satM":30}'));
    // Android CAN share files too — and must still get the download it has always had.
    await fakeShareDevice(page, ANDROID_UA);
    await page.goto('/paycalc.html#payTransferCard');
    await expect(page.locator('#payTransferBody')).toHaveClass(/open/);

    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#ptDownload').click()]);
    expect(download.suggestedFilename()).toMatch(/^myb-pay-backup-gmiller-\d{4}-\d{2}-\d{2}\.json$/);
    expect(await page.evaluate(() => /** @type {any} */ (window).__shares.length), 'Android is never sent to the share sheet').toBe(0);
    const status = page.locator('#ptSaveStatus');
    await expect(status).toContainText(`If you're asked, choose Download`);
    await expect(status, 'the page cannot see a download finish, so it must not claim one').not.toContainText('Saved as');
    await expect(status, 'and it is not dressed as a confirmation either').not.toHaveClass(/pt-status--ok/);
    expect(errors).toHaveLength(0);
});

// Pay figures live in the browser that saved them, and on an iPhone that is two places: Safari and
// the Home Screen app keep separate copies, and Safari clears its own after about a week unvisited.
// So the commonest way to find the calculator EMPTY is to have had figures somewhere else — and the
// setup banner now says where to get them back. Its link must OPEN the card: a bare jump to
// #payTransferCard lands on a closed header, which reads as a dead link.
test('paycalc: an empty calculator points at Restore, and the link opens the backup card', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await seedSession(page);
    await page.addInitScript(PT_QUIET);
    await page.goto('/paycalc.html');
    const line = page.locator('#setupRestore');
    await expect(line).toBeVisible();
    // Not "on this phone": the line shows on a first visit anywhere, the station PC included.
    await expect(line).toContainText('Used the Pay Calculator before?');
    await expect(page.locator('#payTransferBody')).not.toHaveClass(/open/);
    await line.getByRole('link', { name: 'Move Your Pay Data' }).click();
    await expect(page.locator('#payTransferBody')).toHaveClass(/open/);
    await expect(page.locator('#payTransferCard')).toBeInViewport();
    // The card it lands on says why the figures were not here: the iPhone's two copies.
    await expect(page.locator('#payTransferBody')).toContainText('Safari and the Home Screen app keep separate copies');
    expect(errors).toHaveLength(0);
});

// "Saved automatically as you type" was promised whatever the browser did with the figures. Storage
// refuses in two shapes, and only one of them reaches this page:
//   · READS WORK, WRITES THROW — a full quota. The session still reads, the calculator renders, and
//     every figure typed in is gone when the page closes. That is where the promise was false.
//   · THE GETTER THROWS — Safari's "Block All Cookies". The session cannot be read either, so the
//     member meets the sign-in card, never the calculator (the second test pins that, so the
//     warning is never needed there and nobody adds a promise where it would be).
test('paycalc: a browser that will not save says so where it used to promise "Saved automatically"', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await seedSession(page);
    await page.addInitScript(PT_QUIET);
    // AFTER the seeders, so the session they wrote is there to read — then every later write throws.
    await page.addInitScript(() => {
        Object.getPrototypeOf(localStorage).setItem = function () {
            throw new DOMException('quota', 'QuotaExceededError');   // as a full device does
        };
    });
    await page.goto('/paycalc.html');
    await expect(page.locator('#periodSelect option').first()).toBeAttached();
    const header = page.locator('#hoursCard .card-header');
    await expect(header.locator('.hours-save-blocked')).toBeVisible();
    await expect(header).toContainText("This browser isn't letting the app save, so figures you enter here will be lost when you close the page.");
    await expect(header.locator('.hours-save-ok'), 'the promise it cannot keep is gone').toBeHidden();
    // Nothing is saved here, so this is an "empty calculator" — but a restore needs the same
    // writes, so it is not pointed at one.
    await expect(page.locator('#setupBanner')).toBeVisible();
    await expect(page.locator('#setupRestore')).toBeHidden();
    expect(errors).toHaveLength(0);
});

test('paycalc: with storage blocked outright, the member meets sign-in, never a calculator that cannot keep figures', async ({ page }) => {
    await seedSession(page);
    await page.addInitScript(() => {
        Object.defineProperty(window, 'localStorage', {
            configurable: true,
            get() { throw new DOMException('The operation is insecure.', 'SecurityError'); },
        });
    });
    await page.goto('/paycalc.html');
    await expect(page.locator('#loginOverlay')).toBeVisible();
    // The calculator never initialised: no session could be read, so nothing below the sign-in card
    // was built (its static markup sits under the overlay, unpopulated).
    await expect(page.locator('#periodSelect option')).toHaveCount(0);
});

test('paycalc: a browser that saves keeps its "Saved automatically" line', async ({ page }) => {
    await seedSession(page);
    await page.addInitScript(PT_QUIET);
    await page.goto('/paycalc.html');
    await expect(page.locator('#periodSelect option').first()).toBeAttached();
    await expect(page.locator('#hoursCard .hours-save-ok')).toBeVisible();
    await expect(page.locator('#hoursCard .hours-save-blocked')).toBeHidden();
});

/**
 * A tap whose click iOS CANCELLED: with the soft keyboard up, tapping a control dismisses the
 * keyboard first, the viewport shifts, and the tap never becomes a click — the repo's own
 * measurement, recorded on `wireIosTap` (paycalc-inputs.js). touchstart and touchend reach the
 * control; no click ever does. A real tap would deliver the click, which is why this is built by
 * hand rather than with `tap()`.
 * @param {import('@playwright/test').Locator} control
 */
const tapWithoutClick = (control) => control.evaluate((el) => {
    for (const type of ['touchstart', 'touchend']) {
        const e = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperty(e, 'touches', { value: type === 'touchstart' ? [{ clientX: 1, clientY: 1 }] : [] });
        el.dispatchEvent(e);
    }
});

test('paycalc: with the keypad up, ONE tap works the controls iOS needed two for', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await seedSession(page);
    await page.addInitScript(PT_QUIET);
    await page.goto('/paycalc.html');
    await expect(page.locator('#periodSelect option').first()).toBeAttached();
    const period = () => page.locator('#periodSelect').evaluate(s => Number(/** @type {HTMLSelectElement} */ (s).value));
    const start = await period();
    await tapWithoutClick(page.locator('#prevBtn'));
    await expect.poll(period, '← Earlier').toBe(start - 1);
    await tapWithoutClick(page.locator('#nextBtn'));
    await expect.poll(period, 'Later →').toBe(start);
    // 📍 and the tax-year tabs move the page as the arrows do, and were bare clicks (whole-app check,
    // 10 Nov 2026): with the keypad up, the tap that should have jumped did nothing.
    await tapWithoutClick(page.locator('#prevBtn'));
    await expect.poll(period, '← Earlier, again').toBe(start - 1);
    await tapWithoutClick(page.locator('#todayPeriodBtn'));
    await expect.poll(period, '📍 back to the payslip being earned').toBe(start);
    await tapWithoutClick(page.locator('#tyTab0'));
    await expect.poll(period, 'the 2025/26 tab — that year ends with internal period 49').toBeLessThanOrEqual(49);
    await tapWithoutClick(page.locator('#todayPeriodBtn'));
    await expect.poll(period, '📍 from another tax year').toBe(start);
    await tapWithoutClick(page.locator('#peerPlus'));
    await expect(page.locator('#peerVal'), 'the peer-training +').toHaveText('1');
    await tapWithoutClick(page.locator('#peerMinus'));
    await expect(page.locator('#peerVal'), 'the peer-training −').toHaveText('0');
    await expect(page.locator('#setupBanner')).toBeVisible();
    await tapWithoutClick(page.locator('#saveSettingsBtn'));
    await expect(page.locator('#setupBanner'), 'Save settings confirms the year').toBeHidden();
    // The take-home bar shows while the £ figure is off screen (below the fold at the top of a
    // phone's page), and one tap takes the member to it.
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(page.locator('#stickyTotal')).toBeVisible();
    await tapWithoutClick(page.locator('#stickyTotal'));
    await expect(page.locator('#netDisplay'), 'the take-home bar').toBeInViewport();
    expect(errors).toHaveLength(0);
});

// The same tap must let go of the field FIRST, as a native tap would have: the guard that stops a
// duplicate click also cancels the tap's move of focus. The prior-year Holiday Pay Premium commits
// only on `change`, so a figure typed there and followed by "← Earlier" committed AFTER the page
// had moved — here, into 2025/26, which has no prior year on record, so the figure was lost.
test('paycalc: a tap on ← Earlier lets go of the field first, so its figure lands on the year it was typed for', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await seedSession(page);
    await page.addInitScript(PT_QUIET);
    // A figure already on record keeps the box open before the January 2027 payslip exists.
    await page.addInitScript(() => localStorage.setItem('myb_pc_gmiller_hpp_actual_2025_26', '100.00'));
    await page.goto('/paycalc.html');
    await expect(page.locator('#periodSelect option').first()).toBeAttached();
    // P50 is the first 2026/27 payslip, so ONE step back crosses into 2025/26.
    await page.locator('#periodSelect').evaluate((s) => {
        /** @type {HTMLSelectElement} */ (s).value = '50';
        s.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.locator('#hppCardToggle').click();
    const box = page.locator('#priorHppActualInput');
    await expect(box).toHaveValue('100.00');
    await box.fill('1843.01');
    await tapWithoutClick(page.locator('#prevBtn'));
    await expect.poll(() => page.locator('#periodSelect').evaluate(s => /** @type {HTMLSelectElement} */ (s).value)).toBe('49');
    expect(await page.evaluate(() => localStorage.getItem('myb_pc_gmiller_hpp_actual_2025_26')),
        'the 2025/26 premium typed on a 2026/27 payslip is kept for 2025/26').toBe('1843.01');
    expect(errors).toHaveLength(0);
});

// Typed, then swiped away from: the figure commits only on `change`, which fires when the field is
// left — and a page that is hidden and never comes back is never left. Hiding now lets go of it.
test('paycalc: hiding the page commits the prior-year Holiday Pay Premium being typed', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await seedSession(page);
    await page.addInitScript(PT_QUIET);
    await page.addInitScript(() => localStorage.setItem('myb_pc_gmiller_hpp_actual_2025_26', '100.00'));
    await page.goto('/paycalc.html');
    await expect(page.locator('#periodSelect option').first()).toBeAttached();
    await page.locator('#hppCardToggle').click();
    const box = page.locator('#priorHppActualInput');
    await expect(box).toHaveValue('100.00');
    await box.fill('1843.01');
    expect(await page.evaluate(() => localStorage.getItem('myb_pc_gmiller_hpp_actual_2025_26')),
        'not yet — it commits on leaving the field, by design (v17.26)').toBe('100.00');
    // What swiping to the Home Screen does to the page: it is hidden, and nothing else happens.
    await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
        document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(await page.evaluate(() => localStorage.getItem('myb_pc_gmiller_hpp_actual_2025_26'))).toBe('1843.01');
    expect(errors).toHaveLength(0);
});

// THE TAKE-HOME BAR WITH THE KEYPAD UP. The keyboard covers the bottom of the layout viewport without
// shrinking it, so typing on the Overtime or Rest Day Working rows put the £ behind the keys while the
// IntersectionObserver still called it "in view" — and no bar came. Where the bar did come, pinned
// above the keys, it sat on the very box being typed in. The rules are unit-tested
// (paycalc-sticky-total.test.mjs); this runs the real module on a real page. Playwright raises no
// soft keyboard, so a stand-in visualViewport — read by nothing else in the app — is shrunk instead.
test('paycalc: with the keypad up, the take-home bar comes when the £ is behind the keys, and clears the box being typed in', async ({ page }, info) => {
    test.skip(!isTouchProject(info), 'the keyboard rules are for a coarse pointer');
    const errors = collectFatalErrors(page);
    await seedSession(page);
    await page.addInitScript(PT_QUIET);
    await page.addInitScript(() => {
        const vv = new EventTarget();
        let height = window.innerHeight;
        Object.defineProperty(vv, 'height', { get: () => height });
        Object.defineProperty(vv, 'offsetTop', { get: () => 0 });
        Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => vv });
        /** @type {any} */ (window).__keyboardTo = (/** @type {number} */ h) => { height = h; vv.dispatchEvent(new Event('resize')); };
    });
    await page.goto('/paycalc.html');
    // Settled, and the calendar read answered: the roster hint bar arrives with it and would move
    // every row under a geometry measured too soon.
    await waitForPageSettled(page);
    await waitForReadsToLand(page);
    // …and a first visit's Settings card has finished opening: it grows ~900px in the 0.3s after the
    // page is ready, so a scroll taken mid-reveal left the £ wherever the rest of it pushed the page.
    await page.evaluate(() => Promise.all(document.getAnimations()
        .filter(a => a instanceof CSSTransition).map(a => a.finished.catch(() => null))));
    const bar = page.locator('#stickyTotal');

    // The £ low in the layout viewport: in view by the observer's lights, so no bar yet.
    await page.evaluate(() => {
        const net = /** @type {HTMLElement} */ (document.getElementById('netDisplay'));
        window.scrollBy(0, net.getBoundingClientRect().top - (window.innerHeight - 60));
    });
    await expect(bar).toBeHidden();

    // Type on the Rest Day Working row, and raise a keyboard whose top is just below the box — where
    // iOS puts a focused box — so the £ is now behind the keys.
    const geometry = await page.evaluate(() => {
        const box = /** @type {HTMLInputElement} */ (document.getElementById('rdwH'));
        box.focus({ preventScroll: true });
        const boxBottom = box.getBoundingClientRect().bottom;
        const keysTop = Math.round(boxBottom + 20);
        /** @type {any} */ (window).__keyboardTo(keysTop);
        const net = /** @type {HTMLElement} */ (document.getElementById('netDisplay')).getBoundingClientRect();
        return { keysTop, netTop: net.top, innerHeight: window.innerHeight };
    });
    expect(geometry.netTop, 'the setup must put the £ behind the keys and inside the layout viewport')
        .toBeGreaterThan(geometry.keysTop);
    expect(geometry.netTop).toBeLessThan(geometry.innerHeight);
    await expect(bar, 'the £ is behind the keyboard, so the bar must carry it').toBeVisible();
    await expect(bar).toHaveClass(/keyboard-up/);

    // …and the bar, pinned above the keys, does not sit on the box being typed in.
    await expect.poll(() => page.evaluate(() => {
        const box = /** @type {HTMLElement} */ (document.getElementById('rdwH')).getBoundingClientRect();
        const b = /** @type {HTMLElement} */ (document.getElementById('stickyTotal')).getBoundingClientRect();
        return Math.round(b.top - box.bottom);
    }), { message: 'the gap between the box and the bar above the keys' }).toBeGreaterThanOrEqual(7);
    expect(errors).toHaveLength(0);
});

// ── THE DESKTOP AUDIT (7 Nov 2026) ──────────────────────────────────────────────────────────────
// A laptop with a keyboard and a mouse — the station PC's shape. Each test pins one finding by what a
// member meets there: where Tab goes, what it can reach, what the pointer does to what it points at.
// July is the audit's own day (the visual harness's): P20, seventeen rows into a 26-row period list,
// with Saturday and Sunday shifts the calendar row can match.
const AUDIT_DAY = new Date('2026-07-15T09:00:00Z');

/** Calculated, and the calendar read answered, so the roster card and its rows are drawn. Not
 *  `waitForPageSettled`: the pinned clock suppresses `performance.mark`, which it waits on. */
async function payPageReady(page) {
    await expect(page.locator('#netDisplay')).toHaveText(/£\d/);
    await expect.poll(() => page.evaluate(async () =>
        (await import('./paycalc-roster-suggestions.js')).getOverridesFetchState()),
        { message: 'the recorded-changes read never answered' }).not.toBe('checking');
}

/** A returning member: settings saved, so Your Settings starts SHUT, as it does for everyone after
 *  their first visit; the one-time notices out of the way. */
async function openReturning(page, size = { width: 1366, height: 768 }) {
    await page.clock.setFixedTime(AUDIT_DAY);
    await page.setViewportSize(size);
    await seedSession(page);
    await page.addInitScript(PT_QUIET);
    await page.addInitScript(() => { localStorage.setItem('myb_pc_gmiller_setup', '1'); });
    await page.goto('/paycalc.html');
    await payPageReady(page);
}

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
    // leads the work column again, as a first-time member on a phone meets it.
    await page.setViewportSize({ width: 900, height: 900 });
    await expect.poll(() => page.evaluate(() => document.querySelector('.pc-work')?.firstElementChild?.id)).toBe('settingsCard');
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
        await expect(page.locator('#helpLightbox')).toHaveClass(/open/);
        const w = await page.evaluate(() => {
            const probe = document.createElement('div');
            probe.style.cssText = 'position:absolute;width:min(var(--modal-standard), var(--modal-cap))';
            document.body.appendChild(probe);
            const want = probe.offsetWidth;
            probe.remove();
            return { want, got: /** @type {HTMLElement} */ (document.getElementById('helpLightboxContent')).offsetWidth };
        });
        expect(w.got, `the sheet at ${width}px`).toBe(w.want);
        await page.keyboard.press('Escape');
        await expect(page.locator('#helpLightbox')).not.toHaveClass(/visible/);
    }
});

// PAY7 — `.roster-row:hover` (0,2,0) outranked the "matches"/"differs" tints (0,1,0), so pointing at a
// row that carried a verdict turned it the plain grey of a row with none.
test('paycalc: pointing at a calendar row keeps its "matches" tint', async ({ page }, info) => {
    test.skip(isTouchProject(info), 'hover is a fine pointer\'s');
    await openReturning(page);
    const row = page.locator('.roster-row--matched').first();
    await expect(row, 'the July payslip\'s weekend shifts match the calendar').toBeVisible();
    const paint = () => row.evaluate(el => {
        const probe = document.createElement('div');
        probe.style.background = 'var(--bg-faint)';
        document.body.appendChild(probe);
        const grey = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return { bg: getComputedStyle(el).backgroundColor, grey };
    });
    const rest = (await paint()).bg;
    await row.hover();
    await expect.poll(async () => (await paint()).bg, { message: 'the hover lands' }).not.toBe(rest);
    // The row eases its background, so read the colour it SETTLES on: mid-ease, every value differs
    // from both ends, and the grey would pass for a tint.
    await row.evaluate(el => Promise.all(el.getAnimations().map(a => a.finished.catch(() => null))));
    const hovered = await paint();
    expect(hovered.bg, 'a verdict row keeps its own tint under the pointer, not the plain grey').not.toBe(hovered.grey);
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

// PAY11 — six period-band controls and notes at --type-micro (10px), read at arm's length on a laptop.
// A density call, so a fine pointer gets the small step and a coarse one keeps the phone's.
test('paycalc: the period band\'s small print is the small step on a desktop with a mouse', async ({ page }, info) => {
    await openReturning(page);
    const sizes = await page.evaluate(() => ['#saveStatus', '#clearBtn', '#rosterViewLink', '.period-hint', '#rosterDaysToggle', '#periodBadge']
        .map(sel => getComputedStyle(/** @type {Element} */ (document.querySelector(sel))).fontSize));
    expect(sizes).toEqual(Array(6).fill(isTouchProject(info) ? '10px' : '12px'));
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
    await expect(page.locator('#helpLightbox')).toHaveClass(/open/);
    const words = await page.evaluate(() => [document.body.innerText,
        ...[...document.querySelectorAll('[aria-label]')].map(e => e.getAttribute('aria-label'))].join('\n'));
    expect(words.match(/[^\n]*\btap(s|ped|ping)?\b[^\n]*/gi) ?? []).toEqual([]);
});
