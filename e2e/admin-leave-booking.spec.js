/**
 * admin-leave-booking.spec.js — Admin (admin.html): booking leave and absence — the AL banner, the
 * leave year, the leave picker, the preview and the over-allowance question.
 *
 * Split by feature out of admin.spec.js on 25 Nov 2026, test for test and unchanged; what more than
 * one admin-*.spec.js file needs is in admin-helpers.js. admin.spec.js had itself been split out of
 * pages.spec.js on 3 Nov 2026; the tests that span pages, and the shared drawer, dialogs and sheets,
 * stay there.
 */
import { test, expect } from './fixtures.js';
import { collectFatalErrors, seedSession, seedMember, clickInView, seedMemberSession, isTouchProject, waitForReadsToLand, pastDoubleTap } from './helpers.js';
import { isRestShift } from '../override-utils.js';
import { teamMembers, getBaseShift, CONFIG } from '../roster-data.js';
import { fmtPeriodDate } from '../admin-period-dates.js';
import { inventedCea, serveInventedMember, openAdminOnThisWeek, LEAVE_LIST_DAY, deskAdmin } from './admin-helpers.js';

// ── THE SAVE RECEIPT (v21.38, external review) ──────────────────────────────────────────────────
//
// A count cannot answer "did I change the days I meant to?", and the commonest real mistake on this
// page — a right-shaped batch against the wrong days — produces a perfectly plausible count. Driven
// in a browser because the wording is unit-tested but the WIRING is not: whether the days a save
// actually staged reach the receipt is a different pass over the same state.
// ── THE AL COUNT ACTUALLY SEES THE OVERRIDES (v21.84) ───────────────────────────────────────────
//
// The behavioural half of the wiring audit's AL finding. Handing `countedAlDates`/`alPosition` an
// empty override map left 57 unit tests and 8 admin e2es green while a member's entitlement read as
// untouched — the rules are right, and the answer on screen is wrong, which is the shape this
// repo's rule-level tests cannot see.
//
// The banner is the honest target: it is the number a manager actually reads before booking, and it
// runs `alPosition` — a THIRD call site of this family, and one the static call-site guard in
// al-entitlement.test.mjs does not cover (that one pins `countedAlDates`). So this is not a
// duplicate of the guard; it is the part of the family nothing else watches.
//
// The contrast is drawn INSIDE the test — the same page loaded with and without the AL on record —
// because an absolute figure proves nothing here: a member with no leave booked and a member whose
// leave is invisible both read zero.
test('admin: the AL banner counts leave that is already on record', async ({ page }) => {
    const AL_DATES = [];
    for (let d = 1; d <= 28; d++) AL_DATES.push(`2026-06-${String(d).padStart(2, '0')}`);

    /**
     * Select the member the leave belongs to, then read the four banner figures.
     *
     * The selection is load-bearing: the Annual Leave card opens on the FIRST roster member, not on
     * whoever is signed in, and the override read is filtered by that name — so a test that seeds
     * one member's leave and reads another's banner watches a correct zero and proves nothing.
     */
    const readBanner = async () => {
        await page.locator('#fieldMember').selectOption('G. Miller');
        await page.waitForSelector('.day-row', { timeout: 10000 });
        await page.locator('#alToggleHeader').click();
        await expect(page.locator('#alBanner')).toBeVisible();
        return page.evaluate(() => ({
            taken:       Number(document.getElementById('alBannerTaken')?.textContent),
            booked:      Number(document.getElementById('alBannerBooked')?.textContent),
            remaining:   Number(document.getElementById('alBannerRemaining')?.textContent),
            entitlement: Number(document.getElementById('alBannerEntitlement')?.textContent),
        }));
    };

    // 1. NOTHING on record — the baseline this test is a contrast against.
    await page.clock.setFixedTime(new Date('2026-08-27T09:00:00Z'));
    await seedSession(page, 'G. Miller');
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    const clear = await readBanner();
    expect(clear.entitlement, 'a CEA has an entitlement to spend').toBeGreaterThan(0);
    expect(clear.taken, 'no leave on record means none taken').toBe(0);
    expect(clear.remaining).toBe(clear.entitlement);

    // 2. The SAME member, with June's leave on record.
    await page.clock.setFixedTime(new Date('2026-08-27T09:00:00Z'));
    await seedSession(page, 'G. Miller');
    await page.addInitScript((dates) => {
        const w = /** @type {any} */ (window); w.__E2E = w.__E2E || {};
        w.__E2E.docs = dates.map((date, i) => ({
            id: `al-${i}`, memberName: 'G. Miller', date,
            type: 'annual_leave', value: 'AL', note: '', source: 'manual',
        }));
    }, AL_DATES);
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    const booked = await readBanner();

    // June is in the past at the pinned date, so it lands in TAKEN rather than BOOKED.
    expect(booked.taken, 'the leave on record must reach the figure the manager reads').toBeGreaterThan(0);
    expect(booked.taken).toBeLessThanOrEqual(AL_DATES.length);
    expect(booked.entitlement).toBe(clear.entitlement);
    // The four figures have to describe one position, not three independent reads of it.
    expect(booked.remaining, 'remaining must account for what is taken and booked')
        .toBe(booked.entitlement - booked.taken - booked.booked);
});

// ── WHICH YEAR'S ALLOWANCE (v25.18) ─────────────────────────────────────────────────────────────
// A January leave day may come out of the previous year's allowance (owner, 3 Nov 2026 —
// leave-year.js). The panel ships switched OFF until the rules that accept the field are deployed;
// the test seam turns it on, so the real panel is driven while it waits (the Overtime shape). The
// rule and the markup are unit-tested; this proves the WIRING — that a tap reaches the save with the
// right year, and that the figures the panel and the banner read move together.
test('admin: a January leave day can be moved to last year\'s allowance, and back', async ({ page }) => {
    const DAY = '2027-01-05';                        // a worked Tuesday on his line
    const REC = { memberName: 'G. Miller', date: DAY, type: 'annual_leave', value: 'AL', note: '', source: 'manual' };
    await page.clock.setFixedTime(new Date('2026-11-03T09:00:00Z'));
    await seedSession(page, 'G. Miller');
    await page.addInitScript((rec) => {
        const w = /** @type {any} */ (window); w.__E2E = w.__E2E || {};
        w.__E2E.leaveYearChoice = true;
        w.__E2E.authUser = true;          // a write needs the signed-in Firebase user, as every save test here
        w.__E2E.docs = [{ id: 'm_2027-01-05_G.%20Miller', ...rec }];
    }, REC);
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    await page.locator('#fieldMember').selectOption('G. Miller');
    await page.locator('#alToggleHeader').click();

    const panel = page.locator('#alLeaveYear');
    await expect(panel).toBeVisible();
    const figures = panel.locator('.ly-figures');
    await expect(figures).toHaveText('2026: 32 days left · 2027: 31 days left');
    const y2026 = panel.locator(`.leaveyear-opt[data-date="${DAY}"][data-year="2026"]`);
    const y2027 = panel.locator(`.leaveyear-opt[data-date="${DAY}"][data-year="2027"]`);
    await expect(y2027).toHaveAttribute('aria-pressed', 'true');

    // The save checks the day and writes it in ONE transaction (v25.89), which reads the seeded rows.
    await y2026.click();
    await expect(y2026).toHaveAttribute('aria-pressed', 'true');
    await expect(figures).toHaveText('2026: 31 days left · 2027: 32 days left');
    await expect(page.locator('#alLeaveYearFeedback')).toContainText('now comes out of 2026’s allowance');
    // The panel is redrawn twice around the save; the keyboard's place is the year just chosen (21 Nov 2026).
    await expect(y2026, 'focus is not dropped to the page when the panel redraws').toBeFocused();
    const moved = await page.evaluate(() => /** @type {any} */ (window).__E2E.setWrites.at(-1).data);
    expect(moved).toMatchObject({ date: DAY, type: 'annual_leave', value: 'AL', leaveYear: 2026, source: 'manual', changedBy: 'G. Miller' });

});

// January 2026 joined the choice at v26.18 (owner, 15 Nov 2026): its days can come out of 2025's
// allowance until the panel lets January 2026 go, at the end of 2026. The years are unit-tested in
// leave-year.test.mjs; this drives the real panel and save for the new January, so a copy of the
// start year anywhere between the two would fail here.
test('admin: a January 2026 leave day can be moved to 2025\'s allowance', async ({ page }) => {
    const DAY = '2026-01-05';                        // a worked Monday on his line
    const REC = { memberName: 'G. Miller', date: DAY, type: 'annual_leave', value: 'AL', note: '', source: 'manual' };
    await page.clock.setFixedTime(new Date('2026-11-15T09:00:00Z'));
    await seedSession(page, 'G. Miller');
    await page.addInitScript((rec) => {
        const w = /** @type {any} */ (window); w.__E2E = w.__E2E || {};
        w.__E2E.leaveYearChoice = true;
        w.__E2E.authUser = true;
        w.__E2E.docs = [{ id: 'm_2026-01-05_G.%20Miller', ...rec }];
    }, REC);
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    await page.locator('#fieldMember').selectOption('G. Miller');
    await page.locator('#alToggleHeader').click();

    const panel = page.locator('#alLeaveYear');
    await expect(panel).toBeVisible();
    const figures = panel.locator('.ly-figures');
    await expect(figures).toHaveText('2025: 32 days left · 2026: 31 days left');
    const y2025 = panel.locator(`.leaveyear-opt[data-date="${DAY}"][data-year="2025"]`);
    await expect(panel.locator(`.leaveyear-opt[data-date="${DAY}"][data-year="2026"]`)).toHaveAttribute('aria-pressed', 'true');

    await y2025.click();
    await expect(y2025).toHaveAttribute('aria-pressed', 'true');
    await expect(figures).toHaveText('2025: 31 days left · 2026: 32 days left');
    await expect(page.locator('#alLeaveYearFeedback')).toContainText('now comes out of 2025’s allowance');
    const moved = await page.evaluate(() => /** @type {any} */ (window).__E2E.setWrites.at(-1).data);
    expect(moved).toMatchObject({ date: DAY, type: 'annual_leave', value: 'AL', leaveYear: 2025, source: 'manual', changedBy: 'G. Miller' });
});

// The way back, from a fresh load of a day already moved — the stub's transaction does not write its
// sets back into the seeded rows, so a second save on the same page would find the server still
// holding the first state and (rightly, as far as it can tell) refuse. The stale-page refusal,
// including the colleague who saves in the middle of the move, is unit-tested.
test('admin: a moved January day moves forward again, recorded as nothing', async ({ page }) => {
    const MOVED = { memberName: 'G. Miller', date: '2027-01-05', type: 'annual_leave', value: 'AL', note: '',
        source: 'manual', leaveYear: 2026 };
    await page.clock.setFixedTime(new Date('2026-11-03T09:00:00Z'));
    await seedSession(page, 'G. Miller');
    await page.addInitScript((rec) => {
        const w = /** @type {any} */ (window); w.__E2E = w.__E2E || {};
        w.__E2E.leaveYearChoice = true;
        w.__E2E.authUser = true;
        w.__E2E.docs = [{ id: 'm_2027-01-05_G.%20Miller', ...rec }];
    }, MOVED);
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    await page.locator('#fieldMember').selectOption('G. Miller');
    await page.locator('#alToggleHeader').click();
    const panel = page.locator('#alLeaveYear');
    await expect(panel.locator('.ly-figures')).toHaveText('2026: 31 days left · 2027: 32 days left');
    const y2027 = panel.locator('.leaveyear-opt[data-date="2027-01-05"][data-year="2027"]');
    await y2027.click();
    await expect(y2027).toHaveAttribute('aria-pressed', 'true');
    await expect(panel.locator('.ly-figures')).toHaveText('2026: 32 days left · 2027: 31 days left');
    const back = await page.evaluate(() => /** @type {any} */ (window).__E2E.setWrites.at(-1).data);
    expect(back).toMatchObject({ date: '2027-01-05', type: 'annual_leave' });
    expect('leaveYear' in back, 'its own year is the default, and the default is no record').toBe(false);
});

test('admin: with the switch off, the year panel is not there at all', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-11-03T09:00:00Z'));
    await seedSession(page, 'G. Miller');
    await page.addInitScript(() => {
        const w = /** @type {any} */ (window); w.__E2E = w.__E2E || {};
        w.__E2E.leaveYearChoice = false;   // pinned OFF — the constant is on since v25.19
        w.__E2E.docs = [{ id: 'm_2027-01-05_G.%20Miller', memberName: 'G. Miller', date: '2027-01-05',
            type: 'annual_leave', value: 'AL', note: '', source: 'manual' }];
    });
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    await page.locator('#fieldMember').selectOption('G. Miller');
    await page.locator('#alToggleHeader').click();
    await expect(page.locator('#alBanner')).toBeVisible();     // the card did load his leave…
    await expect(page.locator('#alLeaveYear')).toBeHidden();   // …and offers no choice
    await expect(page.locator('#alLeaveYear')).toHaveCSS('display', 'none');
});

// ── THE BANNER DESCRIBES THE YEAR THE READER IS LOOKING AT (v22.82) ──────────────────────────
// Reported by the owner: scrolled the picker to February 2027 and the four figures still described
// 2026 — 26 taken, 2 remaining — so next year's untouched 32 days read as all but spent.
//
// The SAVE was never wrong: it reads the picked dates, so an actual 2027 booking counted against
// 2027. What is wrong is the number a manager reads BEFORE booking, and that is the one a request
// gets refused on. This is an e2e rather than a unit test because the defect is entirely in the
// wiring — the year ladder is four lines in `updateALBanner`, each individually right, and what was
// missing was any path from the picker's month to the function at all.
//
// Asserted in BOTH directions. Scrolling forward and finding a fresh entitlement proves the hook
// fires; scrolling back and recovering the original figures proves it tracks rather than latches,
// which a one-way test would call a pass for a banner stuck on 2027 for the rest of the session.
test('admin: the AL banner follows the year the picker is showing', async ({ page }) => {
    const AL_DATES = [];
    for (let d = 1; d <= 26; d++) AL_DATES.push(`2026-06-${String(d).padStart(2, '0')}`);

    await page.clock.setFixedTime(new Date('2026-08-27T09:00:00Z'));
    await seedSession(page, 'G. Miller');
    await page.addInitScript((dates) => {
        const w = /** @type {any} */ (window); w.__E2E = w.__E2E || {};
        w.__E2E.docs = dates.map((/** @type {string} */ d, /** @type {number} */ i) => ({
            id: 'al' + i, memberName: 'G. Miller', date: d, type: 'annual_leave', value: 'AL', note: '',
        }));
    }, AL_DATES);
    await page.goto('/admin.html');
    await page.locator('#fieldMember').selectOption('G. Miller');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    await page.locator('#alToggleHeader').click();
    await expect(page.locator('#alBanner')).toBeVisible();

    const read = () => page.evaluate(() => ({
        taken:       Number(document.getElementById('alBannerTaken')?.textContent),
        remaining:   Number(document.getElementById('alBannerRemaining')?.textContent),
        entitlement: Number(document.getElementById('alBannerEntitlement')?.textContent),
    }));
    /** Six presses from August reaches February — the month in the report. */
    const scroll = async (/** @type {string} */ id) => {
        for (let i = 0; i < 6; i++) { await page.locator(id).click(); await page.waitForTimeout(60); }
    };

    const thisYear = await read();
    expect(thisYear.taken, 'the fixture must actually be on record, or every figure below is a true zero')
        .toBeGreaterThan(0);
    // AND IT SAYS WHICH YEAR (whole-app check, Nov 2026; admin-2-14): four figures with no year beside them.
    const entLbl = page.locator('#alBannerLblEntitlement');
    await expect(entLbl).toHaveText('2026 entitlement');
    // …AND SO DOES THE COLLAPSED CARD'S CHIP (review, Nov 2026): "AL left: N" named no year, so in December it
    // could be read as next year's balance, or the other way round.
    const chip = page.locator('#alHeaderBalance');
    await expect(chip).toHaveText(`2026: ${thisYear.remaining} left`);

    await scroll('#alRpNext');
    await expect(page.locator('#alRpLabel, #alRangePicker .rp-label')).toContainText('2027');
    await expect(entLbl, 'the year moves with the figures').toHaveText('2027 entitlement');
    const nextYear = await read();
    expect(nextYear.taken, 'leave taken in 2026 is being counted against 2027').toBe(0);
    expect(nextYear.remaining, 'a year with nothing booked shows the whole entitlement')
        .toBe(nextYear.entitlement);
    await expect(chip, 'the chip names the year its figure is for').toHaveText(`2027: ${nextYear.remaining} left`);

    await scroll('#alRpPrev');
    const backAgain = await read();
    expect(backAgain, 'the banner latched on the later year instead of tracking the picker')
        .toEqual(thisYear);
});

// ── AND STRAIGHT AFTER A BOOKING IT STAYS ON THE YEAR JUST BOOKED (whole-app check, 10 Nov 2026) ──
// The save reset the picker to today's month, which crossed the year back and told the banner to
// switch, so a manager who had just booked January read THIS year's figures under "✓ Recorded". The
// owner's decided default: keep showing the year just booked. Through the real save.
test('admin: straight after booking next year’s leave, the picker and the banner stay on that year', async ({ page }) => {
    test.setTimeout(40_000);
    const me = /** @type {any} */ (teamMembers.find(m => m.name === 'G. Miller'));
    const iso = (/** @type {Date} */ d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const works = (/** @type {Date} */ d) => d.getDay() !== 0 && /^\d\d:\d\d-/.test(getBaseShift(me, d));
    /** @type {string[]} */ let pair = [];
    for (let d = new Date(2027, 0, 4); d.getMonth() === 0 && !pair.length; d.setDate(d.getDate() + 1)) {
        const next = new Date(d); next.setDate(d.getDate() + 1);
        if (works(d) && works(next)) pair = [iso(d), iso(next)];
    }
    expect(pair, 'premise: two working days running in January 2027 on G. Miller\'s line').toHaveLength(2);
    const AL_DATES = [];
    for (let d = 1; d <= 26; d++) AL_DATES.push(`2026-06-${String(d).padStart(2, '0')}`);

    await page.clock.setFixedTime(new Date('2026-11-03T09:00:00Z'));
    await seedSession(page, 'G. Miller');
    await page.addInitScript((dates) => {
        const w = /** @type {any} */ (window); w.__E2E = w.__E2E || {};
        w.__E2E.authUser = true;          // a write needs the signed-in Firebase user, as every save test here
        w.__E2E.docs = dates.map((/** @type {string} */ d, /** @type {number} */ i) => ({
            id: 'al' + i, memberName: 'G. Miller', date: d, type: 'annual_leave', value: 'AL', note: '',
        }));
    }, AL_DATES);
    await page.goto('/admin.html');
    await page.locator('#fieldMember').selectOption('G. Miller');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    await page.locator('#alToggleHeader').click();
    const label  = page.locator('#alRpLabel');
    const taken  = page.locator('#alBannerTaken');
    const booked = page.locator('#alBannerBooked');   // leave after today — the whole of 2027's
    await expect(taken, 'premise: this year\'s leave is on record').not.toHaveText('0');
    for (let i = 0; i < 2; i++) await page.locator('#alRpNext').click();
    await expect(label).toHaveText('January 2027');
    await expect(taken, 'premise: the banner moved to 2027 with the picker').toHaveText('0');
    await expect(booked).toHaveText('0');

    await page.locator(`#alRpGrid .rp-day[data-iso="${pair[0]}"]`).click();
    await page.locator(`#alRpGrid .rp-day[data-iso="${pair[1]}"]`).click();
    await clickInView(page.locator('#alSaveBtn'));
    await expect.poll(() => page.evaluate(() => (/** @type {any} */ (window).__E2E?.batchWrites || []).length),
        { message: 'premise: the booking was written' }).toBeGreaterThan(0);
    await expect(page.locator('#alFeedback')).toContainText('Recorded');
    await expect(page.locator('#alRpFrom'), 'the range clears').toHaveText('Choose start');
    await expect(label, 'the picker went back to today’s month').toHaveText('January 2027');
    await expect(taken, 'the banner switched to this year’s figures under the receipt').toHaveText('0');
    await expect(booked, 'the banner counts the days just booked, in the year they were booked in').toHaveText('2');
});

// ── A PRESS WHOSE RELEASE NEVER REACHES THE LEAVE PICKER (whole-app check, 10 Nov 2026) ──────────
// The month grid started listening on ANY press and stopped only on a release delivered to it, so a
// press released off the grid — or a right-click, whose release the context menu keeps — left the
// month following the mouse with no button held, and the next click turned the page instead of
// choosing a day. The Calendar's swipe has both guards (calendar-swipe.js); the picker now has them.
test('admin: a press released off the leave picker does not leave the month following the mouse', async ({ page }, info) => {
    test.skip(isTouchProject(info), 'a mouse');
    await deskAdmin(page, { width: 1366, height: 900 });
    await page.locator('#alToggleHeader').click();
    const grid = page.locator('#alRpGrid');
    const label = page.locator('#alRpLabel');
    await expect(label).toHaveText('July 2026');
    const box = /** @type {any} */ (await grid.boundingBox());
    const midY = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width / 2, midY);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y - 120);   // straight off the grid, in one move
    await page.mouse.up();                                        // released where the grid cannot hear it
    await page.mouse.move(box.x + 12, midY);                      // back over it, with no button held
    await page.mouse.move(box.x + box.width - 12, midY, { steps: 6 });
    expect(await grid.evaluate(g => g.style.transform), 'the month followed a mouse with no button held').toBe('');
    await page.locator('#alRpGrid .rp-day[data-iso="2026-07-20"]').click();
    await expect(label, 'the click turned the page instead of choosing the day').toHaveText('July 2026');
    await expect(page.locator('#alRpFrom')).toHaveText('Mon 20 Jul');
});

test('admin: a right-click on the leave picker is not the start of a swipe', async ({ page }, info) => {
    test.skip(isTouchProject(info), 'a mouse');
    await deskAdmin(page, { width: 1366, height: 900 });
    await page.locator('#alToggleHeader').click();
    const grid = page.locator('#alRpGrid');
    const box = /** @type {any} */ (await grid.boundingBox());
    const midY = box.y + box.height / 2;
    // The press whose release the context menu keeps: a right-button pointerdown, and nothing after.
    // Dispatched, because a headless browser draws no menu to take the release.
    await grid.evaluate((g, at) => g.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, isPrimary: true,
        pointerType: 'mouse', pointerId: 1, button: 2, buttons: 2, clientX: at.x, clientY: at.y })), { x: box.x + box.width / 2, y: midY });
    await page.mouse.move(box.x + 12, midY);
    await page.mouse.move(box.x + box.width - 12, midY, { steps: 6 });
    expect(await grid.evaluate(g => g.style.transform), 'a right-press started a swipe').toBe('');
});

// ── THE LEAVE PICKER STOPS WHERE THE CALENDAR DOES (whole-app check, 10 Nov 2026) ──────────────
// Nothing bounded it — a run reached 2086 — so leave could be recorded in a year the Calendar cannot
// show and that has no bank holidays to count against. Its arrows, its keys and its swipe stop at
// CONFIG's years now; each is checked at both ends, and the way back from each end still works.
// An arrow at a bound is `aria-disabled` and faded (admin-rangepicker.js) — never `disabled`, which drops
// a keyboard user's focus — so to a mouse it still LOOKED pressable: the hand cursor and the hover fill,
// on a control that does nothing there. It offers neither now; the live arrow beside it still does both.
test('admin: a leave-picker arrow at its bound offers a mouse no hand and no hover fill', async ({ page }, info) => {
    test.skip(isTouchProject(info), 'a mouse');
    await page.clock.setFixedTime(new Date(`${CONFIG.MAX_YEAR}-12-10T09:00:00Z`));
    await page.setViewportSize({ width: 1366, height: 900 });
    await seedSession(page, 'G. Miller');
    await seedMember(page, 'G. Miller');
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    await page.locator('#alToggleHeader').click();
    await expect(page.locator('#alRpNext'), 'premise: the last month has no next').toHaveAttribute('aria-disabled', 'true');
    const look = async (/** @type {string} */ id) => {
        await page.locator(id).hover();
        return page.locator(id).evaluate(el => ({ cursor: getComputedStyle(el).cursor, fill: getComputedStyle(el).backgroundColor }));
    };
    const live = await look('#alRpPrev');
    expect(live.cursor, 'premise: a live arrow offers the hand').toBe('pointer');
    expect(live.fill, 'premise: a live arrow fills under the mouse').not.toBe('rgba(0, 0, 0, 0)');
    expect(await look('#alRpNext')).toEqual({ cursor: 'default', fill: 'rgba(0, 0, 0, 0)' });
});

test('admin: the leave picker stops at the first and last months the Calendar shows', async ({ page }, info) => {
    test.skip(isTouchProject(info), 'buttons, keys and a mouse');
    const label = page.locator('#alRpLabel');
    const grid  = page.locator('#alRpGrid');
    /** Drag across the grid with the mouse, `dir` -1 leftwards (the next month) or +1 rightwards,
     *  running `held` while the button is still down. */
    const drag = async (/** @type {number} */ dir, held = async () => {}) => {
        const box = /** @type {any} */ (await grid.boundingBox());
        const y = box.y + box.height / 2, mid = box.x + box.width / 2;
        await page.mouse.move(mid, y);
        await page.mouse.down();
        await page.mouse.move(mid + dir * box.width * 0.45, y, { steps: 8 });
        await held();
        await page.mouse.up();
    };
    /** Mid-drag at a bound, the one neighbour there is — none is drawn past it. */
    const oneNeighbour = () => expect(page.locator('#alRpClip .rp-adj-panel'), 'a month past the bound, drawn to swipe on to').toHaveCount(1);
    const open = async (/** @type {string} */ iso) => {
        await page.clock.setFixedTime(new Date(`${iso}T09:00:00Z`));
        await page.goto('/admin.html');
        await page.waitForSelector('.day-row', { timeout: 10000 });
        await page.locator('#alToggleHeader').click();
    };
    // The clock FIRST, so the seeded session's expiry is reckoned on it, not on the real date.
    await page.clock.setFixedTime(new Date(`${CONFIG.MAX_YEAR}-12-10T09:00:00Z`));
    await page.setViewportSize({ width: 1366, height: 900 });
    await seedSession(page, 'G. Miller');
    await seedMember(page, 'G. Miller');

    const last = `December ${CONFIG.MAX_YEAR}`;
    await open(`${CONFIG.MAX_YEAR}-12-10`);
    await expect(label).toHaveText(last);
    await expect(page.locator('#alRpNext'), 'an arrow onto a month the Calendar cannot show').toBeDisabled();
    await page.locator(`#alRpGrid .rp-day[data-iso="${CONFIG.MAX_YEAR}-12-31"]`).focus();
    await page.keyboard.press('PageDown');
    await page.keyboard.press('ArrowRight');
    await expect(label, 'a key past the last month').toHaveText(last);
    await expect(page.locator(`#alRpGrid .rp-day[data-iso="${CONFIG.MAX_YEAR}-12-31"]`)).toBeFocused();
    await drag(-1, oneNeighbour);
    await expect.poll(() => grid.evaluate(g => g.style.transform), { message: 'the grid snaps back' }).toBe('');
    await expect(label, 'a swipe past the last month').toHaveText(last);
    // The snap-back's end — it also ends the cooldown that ignores a press straight after a swipe.
    await expect.poll(() => grid.evaluate(g => g.style.willChange), { message: 'the snap-back finishes' }).toBe('');
    await drag(+1);
    await expect(label, 'the swipe back still turns the page').toHaveText(`November ${CONFIG.MAX_YEAR}`);
    const next = page.locator('#alRpNext');
    await expect(next, 'the arrows follow a swipe, not only a render').toBeEnabled();
    await next.focus();
    await page.keyboard.press('Enter');
    await expect(label).toHaveText(last);
    await expect(next).toBeDisabled();
    await expect(next, 'the arrow just pressed keeps the keyboard').toBeFocused();
    await page.keyboard.press('Enter');
    await expect(label, 'the arrow pressed again at the bound').toHaveText(last);

    const first = `January ${CONFIG.MIN_YEAR}`;
    await open(`${CONFIG.MIN_YEAR}-01-10`);
    await expect(label).toHaveText(first);
    const prev = page.locator('#alRpPrev');
    await expect(prev, 'an arrow onto a month the Calendar cannot show').toBeDisabled();
    await prev.focus();
    await page.keyboard.press('Enter');
    await expect(label, 'the arrow pressed at the bound').toHaveText(first);
    await page.locator(`#alRpGrid .rp-day[data-iso="${CONFIG.MIN_YEAR}-01-01"]`).focus();
    await page.keyboard.press('PageUp');
    await page.keyboard.press('ArrowLeft');
    await expect(label, 'a key before the first month').toHaveText(first);
    await drag(+1, oneNeighbour);
    await expect.poll(() => grid.evaluate(g => g.style.transform), { message: 'the grid snaps back' }).toBe('');
    await expect(label, 'a swipe before the first month').toHaveText(first);
    await page.locator('#alRpNext').click();
    await expect(label).toHaveText(`February ${CONFIG.MIN_YEAR}`);
    await expect(page.locator('#alRpPrev')).toBeEnabled();
});

// ── "Recording for <name>" on the AL and Absence cards (v22.45) ──────────────────────────────
// The wiring, not the rule: `_syncMemberFor` is three lines and trivially right, and the defect it
// guards against is that nothing calls it, or that CSS renders the row for the people it was built
// to spare. Both are invisible to a unit test — and the CSS half is the exact `[hidden]` trap
// page-visibility-parity.test.mjs catalogues, where the row draws EMPTY and nothing throws.
test('admin: the leave and absence cards name the person a manager is recording for', async ({ page }) => {
    await seedSession(page, 'G. Miller');           // admin — can point the cards at anybody
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    await page.locator('#alToggleHeader').click();
    await page.locator('#sickToggleHeader').click();

    // The LONGEST name on the roster, deliberately: this row is the reason the chip did not go in
    // the header cluster, and a 23-character name is where a width mistake shows up.
    await page.locator('#fieldMember').selectOption('R. Forrester-Blackstock');
    await expect(page.locator('#alMemberFor')).toBeVisible();
    await expect(page.locator('#sickMemberFor')).toBeVisible();
    await expect(page.locator('#alMemberForName')).toHaveText('R. Forrester-Blackstock');
    await expect(page.locator('#sickMemberForName')).toHaveText('R. Forrester-Blackstock');

    // It must FOLLOW the selector. A row that names whoever was selected when the page loaded is
    // worse than none: it is a confident label on the wrong person.
    await page.locator('#fieldMember').selectOption('G. Miller');
    await expect(page.locator('#alMemberForName')).toHaveText('G. Miller');
    await expect(page.locator('#sickMemberForName')).toHaveText('G. Miller');

    // It sits OUTSIDE #alBanner deliberately: the banner hides itself whenever the entitlement is
    // unknown (v22.45), and the state where a manager most needs to know who they are looking at
    // must not be the state that removes the name. Pinned structurally rather than by selecting a
    // Management member, because none is selectable — every Management row carries `hidden: true`,
    // which is exactly why the null-entitlement guard is a guard and not a fix.
    const nested = await page.evaluate(() =>
        !!document.getElementById('alBanner')?.contains(document.getElementById('alMemberFor')));
    expect(nested, 'the name must not be inside the banner that hides itself').toBe(false);
});

test('admin: a member\'s locked member field reads as locked, not as broken', async ({ page }) => {
    // A non-admin can only see their own data, so the member field is DISABLED — but admin.css has
    // always said it must still read as a normal display box rather than a greyed-out control.
    // It did not, from v23.33 until this release: the rule was `#fieldMember:disabled`, an ID
    // selector, and an ID cannot travel to the trigger button select-sheet.js puts in front of the
    // select. So it un-greyed a control 1px wide and invisible, while the one the member actually
    // looks at took the generic disabled grey plus shared.css's `opacity: .55` and `not-allowed`.
    //
    // Nothing threw, no axe rule fires on it, and `:disabled` is a state no visual baseline
    // captures — so this measures the computed style, which is the only thing that can see it.
    await page.addInitScript(() => { /** @type {any} */ (window).__E2E = { authUser: true, docs: [] }; });
    await seedSession(page, 'L. Springer');   // a plain member: not admin, not manager
    await page.goto('/admin.html');
    const trigger = page.locator('#fieldMemberTrigger');
    await expect(trigger).toBeDisabled();
    const style = await trigger.evaluate(el => {
        const cs = getComputedStyle(el);
        return { opacity: cs.opacity, cursor: cs.cursor };
    });
    expect(style).toEqual({ opacity: '1', cursor: 'default' });
});

// shared-ui-5 — a search box is named by what its list holds. The member picker's title is a question,
// which has no noun to weld onto "Search", so its box was called a bare "Search".
test('admin: the member picker calls its search box "Search staff"', async ({ page }) => {
    await seedSession(page, 'G. Miller');
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    await page.locator('#fieldMemberTrigger').click();
    const box = page.locator('.picker-sheet .picker-search-input');
    await expect(box, 'premise: the staff list earns a search box').toBeVisible();
    await expect(box).toHaveAttribute('aria-label', 'Search staff');
});

test('admin: a member booking their own leave is not told whose leave it is', async ({ page }) => {
    // Not a cosmetic preference. This member cannot change the selector, so the row could only ever
    // say their own name back to them — and an empty `.card-member-for` (the failure mode if the
    // `[hidden]` rule is ever out-specified) is a gold-edged box with nothing in it.
    await seedSession(page, 'S. Silva');            // an ordinary CEA: neither admin nor manager
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    await page.locator('#alToggleHeader').click();
    await page.locator('#sickToggleHeader').click();
    await expect(page.locator('#alMemberFor')).toBeHidden();
    await expect(page.locator('#sickMemberFor')).toBeHidden();
    // ...and their own card still works, so this is a hidden row and not a broken page.
    await expect(page.locator('#alBanner')).toBeVisible();
});

// ── A SAVE WAITING FOR SIGNAL SAYS SO (v24.21) ────────────────────────────────────────────────────
//
// Reported from the field: a shift change sat on "Saving 1 change…" with nothing else on screen, the
// manager swiped the app closed, and on reopening found it had saved. The write was held on the phone
// the whole time — Firestore's commit waits for the SERVER to answer, with no limit. The defect was the
// silence. This holds a commit open through the REAL Change-a-Shift path and checks three things: the
// notice appears while it waits, it never claims the change is saved, and it goes when the write lands
// and the ordinary receipt takes over. The unit test proves the watcher; only this proves it is wired.
// Whole-app review, Oct 2026: a timed success line ("Set 6 days — Sunday skipped") hid itself after 7s
// through `hideFeedback`, which also takes down the over-entitlement bar — so a manager who applied
// to All 7 and pressed Save had the leave question withdrawn from under them mid-decision.
test('admin: the over-entitlement question stays up past an earlier success message\'s timer', async ({ page }) => {
    test.setTimeout(45_000);
    const TAKEN = [];
    for (const m of ['06', '07']) for (let d = 1; d <= 28; d++) TAKEN.push(`2026-${m}-${String(d).padStart(2, '0')}`);
    await page.clock.setFixedTime(new Date('2026-08-27T09:00:00Z'));
    await seedSession(page, 'G. Miller');
    await page.addInitScript((dates) => {
        const w = /** @type {any} */ (window); w.__E2E = w.__E2E || {};
        w.__E2E.docs = dates.map((date, i) => ({ id: `al-${i}`, memberName: 'G. Miller', date,
            type: 'annual_leave', value: 'AL', note: '', source: 'manual' }));
    }, TAKEN);
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    await page.locator('#fieldMember').selectOption('G. Miller');
    await page.locator('#fieldDate').evaluate((el) => {
        /** @type {HTMLInputElement} */ (el).value = '2026-11-16';
        el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect(page.locator('#weekNavLabel')).toContainText('Nov 2026');
    await page.locator('#bulkSelAll').click();
    await page.locator('#bulkTypePills .pill-annual_leave').click();
    await page.locator('#bulkApplyBtn').click();
    await expect(page.locator('#formFeedback')).toContainText('Sunday skipped');   // the timed message
    for (const btn of await page.locator('.day-row .al-swap-btn[data-swap="no"]').all()) {
        if (await btn.isVisible()) await clickInView(btn);   // rest days: free, nothing written
    }
    await clickInView(page.locator('#saveBtn'));
    const bar = page.locator('#alConfirmBar');
    await expect(bar).toHaveClass(/visible/);
    // Past the success line's 7-second fade on the PAGE's clock, not by waiting it out (test audit, 7 Nov 2026:
    // this was a real 7.6s sleep). setFixedTime above installed Playwright's clock, and fastForward
    // fires every timer that falls due inside the jump — the fade's included — while Date stays
    // pinned. 7.6s from here is past the fade however long the clicks above took.
    await page.clock.fastForward(7_600);
    await expect(bar, 'the question must wait for an answer, not for a timer').toHaveClass(/visible/);
});

// ONE BAR, FOUR CARDS (review, 21 Nov 2026): picking a range on the Annual Leave card took down the week
// grid's question unanswered, because every card hid the shared bar on its own routine events. A card
// now takes down only its own question.
test('admin: picking a leave range leaves the week grid\'s over-allowance question up', async ({ page }) => {
    test.setTimeout(45_000);
    const TAKEN = [];
    for (const m of ['06', '07']) for (let d = 1; d <= 28; d++) TAKEN.push(`2026-${m}-${String(d).padStart(2, '0')}`);
    await page.clock.setFixedTime(new Date('2026-08-27T09:00:00Z'));
    await seedSession(page, 'G. Miller');
    await page.addInitScript((dates) => {
        const w = /** @type {any} */ (window); w.__E2E = w.__E2E || {};
        w.__E2E.docs = dates.map((date, i) => ({ id: `al-${i}`, memberName: 'G. Miller', date,
            type: 'annual_leave', value: 'AL', note: '', source: 'manual' }));
    }, TAKEN);
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    await page.locator('#fieldMember').selectOption('G. Miller');
    await page.locator('#fieldDate').evaluate((el) => {
        /** @type {HTMLInputElement} */ (el).value = '2026-11-16';
        el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect(page.locator('#weekNavLabel')).toContainText('Nov 2026');
    await page.locator('#bulkSelAll').click();
    await page.locator('#bulkTypePills .pill-annual_leave').click();
    await page.locator('#bulkApplyBtn').click();
    for (const btn of await page.locator('.day-row .al-swap-btn[data-swap="no"]').all()) {
        if (await btn.isVisible()) await clickInView(btn);
    }
    await clickInView(page.locator('#saveBtn'));
    const bar = page.locator('#alConfirmBar');
    await expect(bar).toHaveClass(/visible/);
    await page.locator('#alToggleHeader').click();
    await page.locator('#alRpNext').click();
    const day = page.locator('#alRpGrid .rp-day[data-iso="2026-09-08"]');
    await day.click();
    await day.click();
    await expect(page.locator('#alSaveBtn')).toBeEnabled();
    await expect(bar, 'the week grid\'s question is still waiting for its answer').toHaveClass(/visible/);
    // CONTROL: a change to the week itself still withdraws it — its batch is out of date.
    await clickInView(page.locator('.day-row .pill-correction:not([disabled])').first());
    await expect(bar).not.toHaveClass(/visible/);
});

// ONE WRITE AT A TIME, "SAVE ANYWAY" INCLUDED (whole-app check, Nov 2026; routed from admin-2). The bar's
// Save anyway ran the week's save whatever else was sending: beside an absence booking still writing, two
// writes to one page at once (the v24.38 duplicate-record race), and the week's save then released the lock
// the booking still held. It now waits, as the cards' own Save buttons do.
test('admin: "Save anyway" does not start while a booking is still sending', async ({ page }) => {
    test.setTimeout(45_000);
    const TAKEN = [];
    for (const m of ['06', '07']) for (let d = 1; d <= 28; d++) TAKEN.push(`2026-${m}-${String(d).padStart(2, '0')}`);
    await page.clock.setFixedTime(new Date('2026-08-27T09:00:00Z'));
    await seedMemberSession(page, 'G. Miller');   // a real user, so neither write is refused
    await page.addInitScript((dates) => {
        const w = /** @type {any} */ (window); w.__E2E = w.__E2E || {};
        w.__E2E.docs = dates.map((date, i) => ({ id: `al-${i}`, memberName: 'G. Miller', date,
            type: 'annual_leave', value: 'AL', note: '', source: 'manual' }));
    }, TAKEN);
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    await page.locator('#fieldMember').selectOption('G. Miller');
    // An absence picked and ready to record (Tue 8 Sep 2026, a working day on his line).
    await page.locator('#sickToggleHeader').click();
    await page.locator('#sickRpNext').click();
    const day = page.locator('#sickRpGrid .rp-day[data-iso="2026-09-08"]');
    await day.click();
    await day.click();
    await expect(page.locator('#sickSaveBtn')).toBeEnabled();
    // A week's leave over the allowance: the bar asks.
    await page.locator('#fieldDate').evaluate((el) => {
        /** @type {HTMLInputElement} */ (el).value = '2026-11-16';
        el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect(page.locator('#weekNavLabel')).toContainText('Nov 2026');
    await page.locator('#bulkSelAll').click();
    await page.locator('#bulkTypePills .pill-annual_leave').click();
    await page.locator('#bulkApplyBtn').click();
    for (const btn of await page.locator('.day-row .al-swap-btn[data-swap="no"]').all()) {
        if (await btn.isVisible()) await clickInView(btn);
    }
    await clickInView(page.locator('#saveBtn'));
    await expect(page.locator('#alConfirmBar')).toHaveClass(/visible/);
    // The absence starts sending, and is held there…
    await page.evaluate(() => { /** @type {any} */ (window).__E2E.holdCommits = true; });
    await clickInView(page.locator('#sickSaveBtn'));
    const held = () => page.evaluate(() => (/** @type {any} */ (window).__E2E._held || []).length);
    await expect.poll(held, { message: 'premise: the booking is sending' }).toBe(1);
    // …and Save anyway, pressed meanwhile, waits.
    await page.locator('#alConfirmSaveBtn').click();
    await expect(page.locator('#formFeedback')).toContainText('Another change is still saving — try again when it has finished.');
    expect(await held(), 'one write at a time').toBe(1);
    await expect(page.locator('#alConfirmBar'), 'the question stays, to answer once the booking is in').toHaveClass(/visible/);
    await page.evaluate(() => /** @type {any} */ (window).__E2E.releaseCommits());
});

// Whole-app review, Oct 2026: a leave range picked while the member's records were still loading was
// previewed from an empty cache — asking about a rest day the records show is worked (RDW) — and the
// load refreshed the banners but never the preview, so the question stayed. Since 28 Nov 2026 the preview
// draws nothing from records that have not been read (admin-range-booking.js): it says they are loading.
test('admin: a leave preview drawn before the member\'s records arrive is redrawn when they do', async ({ page }) => {
    test.setTimeout(30_000);
    await page.clock.setFixedTime(new Date('2026-08-27T09:00:00Z'));
    await seedSession(page, 'G. Miller');
    await page.addInitScript(() => { const w = /** @type {any} */ (window); w.__E2E = w.__E2E || {}; w.__E2E.docs = []; });
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    // The first member's load has landed — counted, not guessed with an 800ms sleep (test audit, 7 Nov 2026).
    expect(await page.evaluate(() => /** @type {any} */ (window).__E2E.docReads || 0),
        'premise: the first member\'s records were asked for').toBeGreaterThan(0);
    await waitForReadsToLand(page, 'the first member\'s load never landed');
    // From here a read is HELD until this test releases it, and holds a worked rest day (Mon 7 Sep is
    // RD on G. Miller's line). Held, not delayed: a 3-second docsDelayMs had to outlast the five steps
    // below, and on a loaded WebKit runner it did not (Nov 2026) — the records landed first, the preview
    // was drawn already right, and the premise failed with nothing wrong in the app.
    await page.evaluate(() => { const e = /** @type {any} */ (window).__E2E; e.docsHeld = true;
        e.docs = [{ id: 'r1', memberName: 'G. Miller', date: '2026-09-07', type: 'rdw', value: '14:00-22:00', note: '', source: 'manual' }]; });
    await page.locator('#fieldMember').selectOption('G. Miller');
    await page.locator('#alToggleHeader').click();
    await expect(page.locator('#alRangePicker')).toBeVisible();
    await page.locator('#alRpNext').click();
    const cell = page.locator('#alRpGrid .rp-day[data-iso="2026-09-07"]');
    await cell.click();
    await cell.click();
    const preview = page.locator('#alPreview');
    await expect(preview, 'drawn before the records arrived, it states nothing about them').toContainText('Still loading this member\'s saved changes');
    await expect(preview).not.toContainText('rest day to answer');
    await page.evaluate(() => { /** @type {any} */ (window).__E2E.docsHeld = false; });   // the records land
    await expect(preview).toContainText('recorded at no cost', { timeout: 8_000 });
    await expect(preview).not.toContainText('rest day to answer');
});

// …AND ONE DRAWN BEFORE A RECORDED PERIOD IS DELETED IS REDRAWN AFTER IT (whole-app check, Nov 2026; admin-2-2).
// Every other path that changes the records redraws both previews; the ✕ in the recorded dates did not, so a
// swapped-in day whose leave was just deleted — a bare rest day now — was saved over without its question.
test('admin: a leave preview is redrawn when a recorded period under it is deleted', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-08-27T09:00:00Z'));
    await seedMemberSession(page, 'G. Miller');   // a real user, so the delete is not refused
    await page.addInitScript(() => {
        /** @type {any} */ (window).__E2E = Object.assign(/** @type {any} */ (window).__E2E || {}, {   // Mon 7 Sep: RD on his line, a declared swap
            docs: [{ id: 'm_2026-09-07_G.%20Miller', memberName: 'G. Miller', date: '2026-09-07', type: 'annual_leave', value: 'AL',
                note: '', source: 'manual', replacedType: 'shift' }] });
    });
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    await page.locator('#fieldMember').selectOption('G. Miller');
    await page.locator('#alToggleHeader').click();
    await page.locator('#alRpNext').click();
    const cell = page.locator('#alRpGrid .rp-day[data-iso="2026-09-07"]');
    await cell.click();
    await cell.click();
    const preview = page.locator('#alPreview');
    await expect(preview).toBeVisible();
    await expect(preview, 'premise: its record settles the question').not.toContainText('rest day to answer');
    await page.locator('#alBookedToggle').click();
    const del = page.locator('#alBookedBody .btn-period-delete[aria-label*="7 Sep"]');
    await del.click();
    await pastDoubleTap(page);
    await del.click();
    await expect(page.locator('#saveToast')).toHaveText(/Deleted 1 day of Annual Leave for G\. Miller/);
    await expect(preview, 'a bare rest day now: asked about again').toContainText('rest day to answer');
});

// THE ✕ TAKES THE OLDER COPY ITS RECORD OUTRANKS (review, Nov 2026), as every other Admin delete has since
// v24.48. A day from before the fixed per-day ids holding an older leave record under a newer absence: the
// Recorded Absence dates ✕ deleted the absence alone, so the leave showed again and the allowance fell by a
// day under "Deleted 1 absence day". The REAL page path, from the ✕ to the deletes the transaction sent.
test('admin: a Recorded Absence dates ✕ deletes the older leave copy under the absence, and names it', async ({ page }) => {
    // An invented member, and one of their working weekdays.
    const who = inventedCea();
    await serveInventedMember(page, who);
    const iso = (/** @type {Date} */ d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    let day = '';
    for (const d = new Date(2026, 8, 7, 12); !day; d.setDate(d.getDate() + 1)) {
        if (d.getDay() !== 0 && !isRestShift(getBaseShift(who, d))) day = iso(d);
    }
    await page.addInitScript((rows) => {
        const w = /** @type {any} */ (window);
        w.__E2E = { ...(w.__E2E || {}), docs: rows };
    }, [{ id: 'older-leave', memberName: who.name, date: day, type: 'annual_leave', value: 'AL', note: '', source: 'manual',
          createdAt: Date.parse('2026-08-01T09:00:00Z') },
        { id: 'newer-absence', memberName: who.name, date: day, type: 'sick', value: 'SICK', note: '', source: 'manual',
          createdAt: Date.parse('2026-08-02T09:00:00Z') }]);
    await openAdminOnThisWeek(page);
    await page.locator('#fieldMember').selectOption(who.name);
    await page.locator('#sickToggleHeader').click();
    await page.locator('#sickBookedToggle').click();
    const del = page.locator('#sickBookedBody .btn-period-delete');
    await expect(del, 'premise: one recorded absence, one ✕').toHaveCount(1);
    await clickInView(del);
    await expect(del).toHaveText('Delete?');
    await pastDoubleTap(page);
    await clickInView(del);
    await expect(page.locator('#saveToast')).toHaveText(`✓ Deleted 1 absence day for ${who.name}, and an earlier entry for ${fmtPeriodDate(day)}`);
    const deleted = await page.evaluate(() => (/** @type {any} */ (window).__E2E.batchDeletes || []).map((/** @type {string} */ p) => p.split('/').pop()));
    expect(deleted.sort(), 'the absence AND the older leave copy, in the one transaction').toEqual(['newer-absence', 'older-leave']);
});

// ── A BALANCE IS A CLAIM ABOUT DATA THAT WAS READ (v23.08, owner report) ────────────────────────
//
// The sibling of the test above, and the half it did not cover. `renderWeekGrid` was taught at
// v21.38 that an unfetched member and a member with a clear week produce the SAME empty slice — so
// it paints a loading state rather than seven base-roster days. Everything ABOVE it on that card
// went on reading the same empty slice as fact: the AL banner stated a full entitlement, `taken 0`
// and `booked 0`, the collapsed header chip said "AL left: 32", and the Recorded Annual Leave dates
// box hid itself, which reads as "nothing booked".
//
// IT IS NOT A FLASH, which is what makes it worth a test. The member switch paints those figures
// BEFORE it starts the fetch, and only a SUCCESSFUL load repaints them — so a failed read leaves
// the wrong number standing indefinitely, two inches above a week grid correctly saying it could
// not load. The write path was never at risk (`recordRangeOverrides` refuses an unread cache), so
// nothing here could be caught by a save test.
//
// The OPPOSITE direction — the guard hiding a banner that should be there — is covered by "the AL
// banner counts leave that is already on record" above and by the two `#alBookedBox` deep-link
// tests below, all of which read the real figures off a successful load.

test('admin: a member whose leave could not be read gets no balance, not a full one', async ({ page }) => {
    await seedSession(page, 'G. Miller');
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    // Open the card so the banner and the dates box are on screen for the whole test.
    await page.locator('#alToggleHeader').click();

    const other = await page.locator('#fieldMember').evaluate((el) => {
        const sel = /** @type {HTMLSelectElement} */ (el);
        const opt = [...sel.options].find(o => o.value && o.value !== sel.value);
        return opt ? opt.value : '';
    });
    expect(other, 'the roster needs a second selectable member for this test').not.toBe('');

    // Fail every read from HERE — the first member loaded fine, so this is a switch that fails,
    // which is the reported path. Setting it before `goto` would test a page that never loaded.
    await page.evaluate(() => { /** @type {any} */ (window).__E2E.failGetDocs = true; });
    await page.locator('#fieldMember').selectOption(other);

    // The week grid is the PROOF THE READ ACTUALLY FAILED. Without it a hidden banner would also be
    // satisfied by a page that simply never got that far, and the test would pass on nothing.
    await expect(page.locator('#weekGrid'), 'the read must genuinely have failed')
        .toContainText(/Couldn't load/i, { timeout: 10000 });

    // Nothing on the card may state a figure derived from the read that failed.
    await expect(page.locator('#alBanner'), 'no balance over a read that failed').toBeHidden();
    await expect(page.locator('#alHeaderBalance'), 'and no leave-left chip on the collapsed header')
        .toBeHidden();
    await expect(page.locator('#alBookedBox'), 'and no dates list implying nothing is booked')
        .toBeHidden();
    // Asserted as TEXT as well, because `hidden` on a banner that also sets `display` renders a
    // live element while every check believes it is gone — the page-visibility-parity trap.
    await expect(page.locator('#alBanner')).toHaveCSS('display', 'none');
    // And no balance is READABLE anywhere on the card, however it got there. `innerText`, not
    // `textContent`: the chip keeps its last value in the DOM while hidden, so textContent finds
    // "2026: 32 left" on a perfectly correct page and the assertion would fail for the wrong reason.
    // This is the one that would catch a THIRD surface printing the figure.
    const visible = await page.locator('#book-annual-leave').innerText();
    expect(visible, 'no readable balance over a read that failed').not.toMatch(/\b\d{4}: -?\d+ (left|over)\b|AL left:/i);
});

// The day panel's "View leave dates" points INSIDE a card, at a box with a fold of its own. Both
// have to open or the link scrolls to something folded away and reads as a button that does
// nothing — which is what it did before v22.91, silently.
test('admin: a deep link to the Recorded Annual Leave dates box opens BOTH folds', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-08-27T09:00:00Z'));
    await seedSession(page, 'G. Miller');
    await page.goto('/admin.html#alBookedBox');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    // Web-first, so each waits for the deep link to have been handled rather than a 400ms guess
    // (test audit, 7 Nov 2026).
    const OPEN = /(^|\s)open(\s|$)/;
    await expect(page.locator('#alBody'), 'the Annual Leave card must open — the box lives inside it').toHaveClass(OPEN);
    await expect(page.locator('#alBookedBody'), 'and the box\'s own fold, or the link lands on the thing it named, closed').toHaveClass(OPEN);
    // `initCardCollapse` only syncs aria on a click, so a class-only open would leave a screen
    // reader hearing "collapsed" on both.
    await expect(page.locator('#alChevron')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#alBookedChevron')).toHaveAttribute('aria-expanded', 'true');
});

// FOLDS OPEN IS NOT THE SAME AS LANDED ON, and the second half is what was reported (6 Sep 2026:
// "it takes me to admin and not to the Recorded Annual Leave dates sub card"). The box sits below
// the banner, the member row, the range picker, the preview and the Save button, so the card's own
// scroll leaves it off the bottom of the screen. Two smooth scrolls a frame apart do NOT resolve to
// the later one — see `createDeepLinkLanding`. Nothing else in the estate can see this: every fold
// is open, every aria state is right, no assertion fails and the member sees no leave dates.
//
// The assertion is the box's BOTTOM EDGE, deliberately. "Did it scroll?" passes on the broken
// behaviour (it scrolled — to the card), and "is it in view?" passes on a box whose last 32px are
// below the fold, which is exactly what shipped.
test('admin: a deep link to the AL box lands with the WHOLE box on screen', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.clock.setFixedTime(new Date('2026-08-27T09:00:00Z'));
    // Recorded leave, or the box renders empty and short enough to fit anywhere by luck.
    await page.addInitScript(() => {
        window.__E2E = { ...(window.__E2E || {}), docs: [
            { id: 'a1', memberName: 'G. Miller', date: '2026-09-14', type: 'annual_leave', value: 'AL', note: '' },
            { id: 'a2', memberName: 'G. Miller', date: '2026-09-15', type: 'annual_leave', value: 'AL', note: '' },
            { id: 'a3', memberName: 'G. Miller', date: '2026-09-16', type: 'annual_leave', value: 'AL', note: '' },
        ] };
    });
    await seedSession(page, 'G. Miller');
    await seedMember(page, 'G. Miller');
    await page.goto('/admin.html#alBookedBox');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    await expect(page.locator('#alBookedBox')).toBeVisible();
    // Wait for the page to STOP and then judge where it stopped (test audit, 7 Nov 2026: this was a fixed 1.5s
    // sleep). "Stopped" is the same box position on two samples 150ms apart — a smooth scroll moves
    // it every frame — and the poll only accepts a stopped page with the whole box on screen, so a
    // scroll that passes through the right place on its way somewhere else does not count, and a
    // page that has not started scrolling yet (the box still below the fold) keeps it waiting.
    // What it reports when it gives up is the last position it saw.
    /** @type {{ top: number, bottom: number, vh: number } | null} */ let last = null;
    await expect.poll(async () => {
        const now = await page.evaluate(() => {
            const r = /** @type {HTMLElement} */ (document.getElementById('alBookedBox')).getBoundingClientRect();
            return { top: Math.round(r.top), bottom: Math.round(r.bottom), vh: window.innerHeight };
        });
        const stopped = !!last && last.top === now.top && last.bottom === now.bottom;
        last = now;
        if (stopped && now.top >= 0 && now.bottom <= now.vh) return 'the whole box on screen';
        return `top ${now.top}, bottom ${now.bottom}, viewport ${now.vh}${stopped ? '' : ' (still moving)'}`;
    }, { intervals: [150], timeout: 6_000, message: 'the box must be on screen, not above it — and the WHOLE box' })
        .toBe('the whole box on screen');
});

// The existing deep links name a CARD, and must behave exactly as they did — the v22.91 change
// walks up to the containing card, which for these is the target itself.
test('admin: the existing card deep link still opens that card', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-08-27T09:00:00Z'));
    await seedSession(page, 'G. Miller');
    await page.goto('/admin.html#book-annual-leave');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    await expect(page.locator('#alBody')).toHaveClass(/(^|\s)open(\s|$)/);   // web-first, not a 400ms guess (test audit, 7 Nov 2026)
});

// ── THE AL AND ABSENCE PICKERS FOLLOW THE MEMBER (v23.42) ────────────────────────────────────────
// Change a Shift's member selection is mirrored into the Annual Leave and Absence pickers by
// `_setSelectValue`, which sets `option.selected` — no attribute mutated, no event fired. Since
// v23.36 the name a manager READS is the enhanced trigger, and it kept the previous person:
// measured as both cards naming "L. Springer" after the page had moved every write path to
// "A. Hared". A booking then goes to the right member under the wrong name, which is the exact
// failure the "Recording for <name>" row exists to prevent, reached from the other side.
//
// `#fieldMember` is asserted too, but it is the weak one: a real user's pick fires `change` on it,
// so it repaints either way. The two it mirrors INTO are the ones with no signal of their own.
test('admin: switching member carries the AL and Absence value holders with it', async ({ page }) => {
    // RE-POINTED AT v23.74, NOT WEAKENED. It was written at v23.42 for the rule that a selection
    // changed IN CODE must announce itself, and it checked that three trigger faces followed the
    // member. Two of those triggers should never have existed: `#alMember` and `#sickMember` are
    // `hidden` value holders, and enhancing them built the phantom member pickers the owner reported
    // on 14 Sep 2026 — so this test was, in part, asserting that a control which should not be on
    // the page stayed correct.
    //
    // The half that matters is kept and sharpened. What those two selects HOLD is what the AL and
    // Absence saves write to, so "they follow the member" is the single most consequential
    // invariant on this page — it is the one whose failure books somebody's leave against the wrong
    // person. That is now asserted directly, alongside the v23.42 face rule for the one member
    // control that is real, and the absence of a visible trigger for the two that are not.
    const errors = collectFatalErrors(page);
    await seedSession(page);
    await page.goto('/admin.html');
    await expect(page.locator('#fieldMember')).toBeAttached();
    await expect(page.locator('#fieldMemberTrigger')).toBeVisible();

    const faces = () => page.evaluate(() => ['fieldMember', 'alMember', 'sickMember'].map(id => ({
        id,
        held: /** @type {HTMLSelectElement} */ (document.getElementById(id))?.selectedOptions[0]?.textContent?.trim() ?? '',
        face: document.querySelector(`#${id}Trigger .fieldpick-face`)?.textContent?.trim() ?? '',
    })));

    const before = await faces();
    expect(before.find(r => r.id === 'fieldMember')?.face, 'the one real member control starts consistent')
        .toBe(before.find(r => r.id === 'fieldMember')?.held);

    // Drive the page's own change handler, as picking a row in the sheet does.
    const moved = await page.evaluate(() => {
        const sel = /** @type {HTMLSelectElement} */ (document.getElementById('fieldMember'));
        const other = [...sel.options].find(o => o.value && o.value !== sel.value && !o.disabled);
        if (!other) return '';
        for (const o of sel.options) o.selected = (o === other);
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        return other.value;
    });
    expect(moved, 'the roster should offer a second selectable member').not.toBe('');

    await expect.poll(async () => (await faces()).find(r => r.id === 'fieldMember')?.held)
        .toBe(moved);

    // ALL THREE must HOLD the new member — the two hidden ones are what the AL and Absence saves
    // read, so a stale value here is leave recorded against the previous person.
    for (const row of await faces()) {
        expect(row.held, `${row.id} should hold the newly chosen member`).toBe(moved);
    }
    // The v23.42 face rule, for the only member control a reader can actually operate.
    expect((await faces()).find(r => r.id === 'fieldMember')?.face,
        'the member control must NAME the member it now holds').toBe(moved);
    // And the two value holders must still be offering nobody a second way to change the member.
    for (const id of ['alMemberTrigger', 'sickMemberTrigger']) {
        await expect(page.locator(`#${id}`), `${id} is a phantom control over a hidden select`).toBeHidden();
    }
    expect(errors, 'Uncaught JS exceptions').toHaveLength(0);
});

// ── NO LEAVE FIGURE IS CUT OFF ON A NARROW PHONE (v23.45) ───────────────────────────────────────
// The AL banner's four stats sit on one flex row, and `flex: 1` will not shrink a box below its
// content: "ENTITLEMENT" is one unbreakable word, so the row demands a fixed 304px however narrow
// the viewport. `#book-annual-leave` is `overflow-x: hidden`, so the surplus was CUT, not scrolled
// — 38px lost at 320, 3px at 355, none from ~356, unchanged since v20.96. 359 is BELOW the fix's
// bound and above the break, so it passes either way: the teeth are at 320 and 340, and removing
// the media query fails exactly those two.
//
// Measured against the CARD's clip edge rather than the viewport, because the page itself never
// overflowed: `document.scrollWidth` stayed equal to `clientWidth` throughout, so the one number a
// layout guard usually watches said everything was fine while a label was being chopped.
//
// 360 and 414 are here as the other half of the assertion. The fix is a `max-width: 359px` query,
// and a query with the wrong bound would silently restyle widths that were never broken.
for (const w of [320, 340, 359, 360, 414]) {
    test(`admin: no annual-leave figure is clipped at ${w}px @layout`, async ({ page }) => {
        const errors = collectFatalErrors(page);
        await page.setViewportSize({ width: w, height: 900 });
        await seedSession(page, 'G. Miller');
        await page.goto('/admin.html');
        await expect(page.locator('#fieldMember')).toBeAttached();
        await page.evaluate(() => document.querySelectorAll('.card-body, [id$="Body"]')
            .forEach(b => b.classList.add('open')));
        await expect(page.locator('#alBanner')).toBeVisible();

        const r = await page.evaluate(() => {
            const card = document.getElementById('book-annual-leave');
            const clipRight = card.getBoundingClientRect().left + card.clientWidth;
            return {
                clipped: [...document.querySelectorAll('.al-banner-stat')]
                    .map(s => ({
                        label: s.querySelector('.stat-lbl')?.textContent?.trim() ?? '?',
                        over: Math.round(s.getBoundingClientRect().right - clipRight),
                    }))
                    .filter(s => s.over > 0),
                statCount: document.querySelectorAll('.al-banner-stat').length,
            };
        });
        expect(r.statCount, 'all four leave figures should be present').toBe(4);
        expect(r.clipped, `these stats are cut off by the card at ${w}px`).toEqual([]);
        expect(errors, 'uncaught JS on admin').toHaveLength(0);
    });
}

// ── THE OVER-LIMIT MESSAGE IS NOT CLIPPED EITHER (v23.78) ───────────────────────────────────────
// The guard above measures the four `.al-banner-stat` boxes and, with a member who is not over
// limit, `#alBannerWarn` is not even rendered — so a FIFTH element on that row was never measured
// by the test written to stop exactly this. It was a third flex item on a row whose stats refuse to
// shrink, so at 390px it collapsed to a sliver and the card's `overflow-x: hidden` cut it: the owner
// photographed "1 over limit" running one character per line down the right edge.
//
// This drives the real path — enough seeded leave to push the member genuinely negative — rather
// than unhiding the element, because `updateALBanner` deciding to SHOW it is half of what broke.
for (const w of [320, 360, 390]) {
    test(`admin: the over-limit message is not clipped at ${w}px @layout`, async ({ page }) => {
        await page.clock.setFixedTime(LEAVE_LIST_DAY);   // the banner counts the year the seeded leave is in
        await page.setViewportSize({ width: w, height: 900 });
        await seedSession(page, 'G. Miller');
        await page.addInitScript(() => {
            // Every date in a three-month span; the ones that consume are well past any entitlement,
            // and the app does its own filtering — so this needs no roster knowledge to stay true.
            const docs = [];
            for (let d = new Date(2026, 1, 2); d < new Date(2026, 4, 1); d.setDate(d.getDate() + 1)) {
                const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                docs.push({ id: 'ol' + iso, memberName: 'G. Miller', date: iso, type: 'annual_leave', value: 'AL', note: '' });
            }
            /** @type {any} */ (window).__E2E = Object.assign(/** @type {any} */ (window).__E2E || {}, { docs });
        });
        await page.goto('/admin.html');
        await expect(page.locator('#fieldMember')).toBeAttached();
        await page.locator('#fieldMember').selectOption('G. Miller');
        await page.evaluate(() => document.querySelectorAll('.card-body, [id$="Body"]')
            .forEach(b => b.classList.add('open')));
        await expect(page.locator('#alBanner')).toBeVisible();

        // THE PREMISE, asserted rather than assumed: if the seeding stopped pushing him over, the
        // message would be hidden and every check below would pass by not looking.
        // OVER, NOT MINUS (owner, 25 Nov 2026): past the allowance the figure has no minus and its label
        // says "Over", as on the Calendar's leave panel (`balanceFace`, al-entitlement.js).
        await expect(page.locator('#alBannerLblRemaining'), 'the fixture must put the member OVER limit, or this tests nothing')
            .toHaveText('Over');
        const over = Number(await page.locator('#alBannerRemaining').textContent());
        expect(over, 'the figure is how far over, never a minus').toBeGreaterThan(0);
        await expect(page.locator('#alHeaderBalance'), 'and the collapsed card\'s chip says it the same way')
            .toHaveText(`2026: ${over} over`);
        const warn = page.locator('#alBannerWarn');
        await expect(warn).toBeVisible();
        await expect(warn).toHaveText(`${over} over allowance`);

        const box = await page.evaluate(() => {
            const card = document.getElementById('book-annual-leave');
            const el = document.getElementById('alBannerWarn');
            const r = el.getBoundingClientRect();
            // One client rect per LINE BOX, which counts wrapped lines exactly. `lineHeight` computes
            // to "normal" here, so dividing by it gives NaN — and NaN quietly fails every numeric
            // comparison, which is how a check like this passes for the wrong reason.
            const range = document.createRange();
            range.selectNodeContents(el);
            return { over: Math.round(r.right - (card.getBoundingClientRect().left + card.clientWidth)),
                     width: Math.round(r.width), lines: range.getClientRects().length };
        });
        expect(box.over, `the over-limit message is cut off by the card at ${w}px`).toBeLessThanOrEqual(0);
        // A sliver is the shape of the defect: wide enough for the words, and on one line.
        expect(box.width, 'the message was squeezed to a sliver').toBeGreaterThan(60);
        expect(box.lines, 'the message wrapped instead of taking its own line').toBeLessThanOrEqual(1);
    });
}

// 6 Nov 2026 review: leave written over a worked Boxing Day is free to SPEND, but the work it replaces
// earned a day in lieu (christmas-leave.js), which goes with it. The range card called that day
// "recorded at no cost" and costed the booking against the allowance before the save, so a member with
// one day left was booked two and ended a day over with no bar. The entry point, end to end: the
// records, the picked range, the preview's words and the bar Save raises.
test('admin: leave over a worked Boxing Day names the day in lieu it takes back, and the bar counts it', async ({ page }) => {
    test.setTimeout(40_000);
    await page.clock.setFixedTime(new Date('2026-11-03T09:00:00Z'));
    const me = /** @type {any} */ (teamMembers.find(m => m.name === 'G. Miller'));
    const iso = (/** @type {Date} */ d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    // 32 days of 2026 leave already on record; with Boxing Day worked the allowance is 33, so one is left.
    /** @type {string[]} */ const leave = [];
    for (let d = new Date(2026, 0, 5); leave.length < 32; d.setDate(d.getDate() + 1)) {
        if (d.getDay() !== 0 && /^\d\d:\d\d-/.test(getBaseShift(me, d))) leave.push(iso(d));
    }
    expect(/^\d\d:\d\d-/.test(getBaseShift(me, new Date(2026, 11, 24))), 'premise: 24 Dec 2026 is a working day on G. Miller\'s line').toBe(true);
    const docs = [
        ...leave.map((date, i) => ({ id: 'al' + i, memberName: 'G. Miller', date, type: 'annual_leave', value: 'AL', note: '', source: 'manual' })),
        { id: 'bx', memberName: 'G. Miller', date: '2026-12-26', type: 'rdw', value: '13:30-21:00', note: '', source: 'manual' },
    ];
    await seedSession(page, 'G. Miller');
    await page.addInitScript((d) => { const w = /** @type {any} */ (window); w.__E2E = w.__E2E || {}; w.__E2E.docs = d; }, docs);
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    await page.locator('#fieldMember').selectOption('G. Miller');
    await page.locator('#alToggleHeader').click();
    await expect(page.locator('#alRangePicker')).toBeVisible();
    await page.locator('#alRpNext').click();
    await page.locator('#alRpGrid .rp-day[data-iso="2026-12-24"]').click();
    await page.locator('#alRpGrid .rp-day[data-iso="2026-12-26"]').click();

    const preview = page.locator('#alPreview');
    await expect(preview).toContainText('Boxing Day recorded as leave, so the day in lieu for working it goes', { timeout: 8_000 });
    await expect(preview, 'the worked Boxing Day is not "at no cost"').not.toContainText('recorded at no cost');
    await clickInView(page.locator('#alSaveBtn'));
    const bar = page.locator('#alConfirmBar');
    await expect(bar, 'one day left, and the save takes the day in lieu back: it ends one over').toHaveClass(/visible/);
    await expect(bar).toContainText('1 day over their 2026 annual leave allowance');
    // CANCEL PUTS FOCUS BACK ON THE SAVE THAT ASKED (whole-app check, Nov 2026): it was left on a hidden button.
    await page.locator('#alConfirmCancelBtn').click();
    await expect(bar).not.toHaveClass(/visible/);
    await expect(page.locator('#alSaveBtn')).toBeFocused();
});

// THE ABSENCE TIP SAYS WHAT A SUNDAY IN THE RANGE BECOMES (whole-app check, Nov 2026; admin-2-4). "Skipped"
// alone was half of it: a Sunday rostered as work inside the range is written as a rest day, so its shift goes.
test('admin: the Record Absence tips say a Sunday rostered as work is set as a rest day', async ({ page }) => {
    await seedSession(page, 'G. Miller');
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    await page.locator('.btn-card-tips[data-card="sick-days"]').click();
    const tips = page.locator('#tipsLbBody');
    await expect(tips).toContainText('Rest days, Christmas Day and Boxing Day, and any day before the member’s start date are skipped automatically');
    await expect(tips).toContainText('A Sunday is never recorded as absence: where the roster has a shift on a Sunday in the range, that Sunday is set as a rest day instead.');
    await expect(tips).toContainText('The preview names each of these days before you save.');
});
