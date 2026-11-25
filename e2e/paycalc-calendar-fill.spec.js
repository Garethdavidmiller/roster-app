/**
 * paycalc-calendar-fill.spec.js — the Pay Calculator (paycalc.html): figures from the calendar — the
 * gold highlight, Fill this tax year, Fill and Replace, and the calendar rows.
 *
 * Split by feature out of paycalc.spec.js on 25 Nov 2026, test for test and unchanged; what more than
 * one paycalc-*.spec.js file needs is in paycalc-helpers.js, including the roster rows these tests sign
 * in as, which are chosen by shape and never written down (payroll-anonymity.test.mjs).
 */
import { test, expect } from './fixtures.js';
import { collectFatalErrors, seedSession, seedMember, clickInView, isTouchProject } from './helpers.js';
import { PAY_2026_27_DAY, openReturning } from './paycalc-helpers.js';

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

// …AND ONE THE CALENDAR MOVES TO ANOTHER BOX IS NOT COUNTED TWICE (review, 20 Nov 2026). v26.37 prices a
// plain shift on a Saturday off as a rostered Saturday, not RDW (v26.41 does the same for a bank holiday),
// so a payslip filled before holds the day in the old box, gold. Reopened, the new box filled and the old
// one stayed: the same hours twice, the old row not even drawn at zero, Replace unable to clear it.
test('paycalc: a calendar figure that moves box is taken out of the old one — never counted twice', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.setViewportSize({ width: 390, height: 900 });
    await page.clock.setFixedTime(new Date('2026-07-15T09:00:00Z'));
    await seedSession(page);
    await seedMember(page);
    // Sat 18 Jul 2026 is a rest day on G. Miller's roster. The record's TYPE is read at each load.
    await page.addInitScript(() => {
        const w = /** @type {any} */ (window);
        const type = sessionStorage.getItem('satType') || 'rdw';
        w.__E2E = { ...(w.__E2E || {}), docs: [{ id: 'o1', memberName: 'G. Miller', date: '2026-07-18', type, value: '08:00-16:00', source: 'manual' }] };
    });
    const loaded = () => expect(page.locator('#rosterStateBadge')).toContainText('Includes recorded changes', { timeout: 10000 });
    await page.goto('/paycalc.html');
    await loaded();
    await page.locator('#fillFromRosterBtn').click();
    await expect(page.locator('#rdwH'), 'premise: recorded as RDW, the calendar\'s 8 hours filled and saved').toHaveValue('8');
    const satBefore = Number(await page.locator('#satH').inputValue() || 0);

    await page.evaluate(() => sessionStorage.setItem('satType', 'shift'));   // the same day, now a moved working day
    await page.reload();
    await loaded();
    await expect(page.locator('#satH'), 'the day is now a rostered Saturday').toHaveValue(String(satBefore + 8));
    await expect(page.locator('#rdwH'), 'and is no longer Rest Day Working as well').toHaveValue('');
    expect(errors, `fatal errors: ${errors.join(', ')}`).toHaveLength(0);
});

// ── Fill this tax year from Calendar (v22.06) ─────────────────────────────────────────────────
// The rules are unit-tested (paycalc-fill-year.test.mjs); only a browser can prove the WIRING —
// that the button the "Not entered yet" line offers runs the real engine against the real
// storage, that the receipt lands, and that a period the member ENTERED survives the bulk write.

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
    await expect(page.locator('#rosterHintText')).toContainText(/✓ Filled .*(Saturday|Sunday|Rest Day Working|Overtime|Bank holiday)/);
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
    await expect(page.locator('#rosterHintText')).toContainText(/✓ Filled .*Rest Day Working/);
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

// THE CALENDAR BUTTON IS A MAIN BUTTON AT EVERY WIDTH (v26.24, the aesthetic check of 16 Nov 2026). Fill from
// calendar — the obvious first action on the page — was 12px below 1024px, the one main button here smaller than
// Save. It is the family's size everywhere now; its longer label, "Replace with calendar values", fits one line
// from 360px and takes two balanced lines at 320px rather than clip. The show-more button under Hours wears the
// button corner with it (it was 8px under 12px fields and buttons). Read against the page's own main-button
// recipe (`.btn-action`), not a number.
test('paycalc: Fill from calendar is a main button at every width, and its longer label never clips', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-07-15T09:00:00Z'));
    await seedSession(page, 'C. Reen');
    await seedMember(page, 'C. Reen');
    await page.goto('/paycalc.html');
    await page.locator('#periodSelect').selectOption('56');
    await page.locator('#bhH').fill('7');
    const btn = page.locator('#fillFromRosterBtn');
    await expect(btn, 'premise: the longer label is showing').toHaveText('Replace with calendar values');
    for (const width of [320, 360, 390, 1280]) {
        await page.setViewportSize({ width, height: 800 });
        const m = await btn.evaluate(el => {
            const main = /** @type {Element} */ (document.querySelector('.btn-action'));
            const more = /** @type {Element} */ (document.getElementById('hoursShowMore'));
            const range = document.createRange();
            range.selectNodeContents(el);
            return {
                size: getComputedStyle(el).fontSize, mainSize: getComputedStyle(main).fontSize,
                lines: new Set([...range.getClientRects()].map(r => Math.round(r.top))).size,
                clipped: el.scrollWidth > el.clientWidth,
                corner: getComputedStyle(more).borderTopLeftRadius, mainCorner: getComputedStyle(main).borderTopLeftRadius,
            };
        });
        expect(m.size, `${width}px: the calendar button is the size of the page's main buttons`).toBe(m.mainSize);
        expect(m.clipped, `${width}px: the label is never cut off`).toBe(false);
        if (width >= 360) expect(m.lines, `${width}px: the longer label fits one line`).toBe(1);
        expect(m.corner, 'the show-more button under Hours wears the button corner').toBe(m.mainCorner);
    }
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
