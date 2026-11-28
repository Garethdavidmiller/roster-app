/**
 * admin-leave-records.spec.js — Admin (admin.html): the recorded leave — the Recorded dates list by
 * year, its deletes, and where focus goes after one.
 *
 * Split by feature out of admin.spec.js on 25 Nov 2026, test for test and unchanged; what more than
 * one admin-*.spec.js file needs is in admin-helpers.js. admin.spec.js had itself been split out of
 * pages.spec.js on 3 Nov 2026; the tests that span pages, and the shared drawer, dialogs and sheets,
 * stay there.
 */
import { test, expect } from './fixtures.js';
import { seedSession, seedMember, clickInView, seedMemberSession, pastDoubleTap } from './helpers.js';
import { isRestShift } from '../override-utils.js';
import { teamMembers, getBaseShift, getPatternShift, parseISODate, CONFIG, isBankHoliday, formatISO } from '../roster-data.js';
import { entitlementFor } from '../al-entitlement.js';
import { inventedCea, serveInventedMember, LEAVE_LIST_DAY } from './admin-helpers.js';

// ── THE LIST COUNTS WHAT THE ENTITLEMENT COUNTS (v23.72, owner report) ─────────────────────────
//
// The owner compared the app against the roster office's own leave spreadsheet and found a member
// a day apart: the app's December period read "Sat 5 – Fri 11 Dec · 6 days", the spreadsheet said
// Mon 7 – Fri 11, and the chips summed to one day more than the allowance.
//
// SAT 5 DEC 2026 WAS A REST DAY on that line, and an AL override had been recorded on it. The
// entitlement maths was already right — `consumesEntitlement` returns false for a rest day, so the
// banner was right — but the recorded-dates list filtered SUNDAYS and nothing else, counted the rest
// day, and started the period a day before the leave did. One card, two disagreeing counts of the
// same thing, with the wrong one next to the ✕ that deletes it.
//
// REAL ROSTER, REAL DATES — and a member chosen by SHAPE, not by name, because this file is served by
// the Pages mirror and a leave test must not set a real name beside a leave count
// (payroll-anonymity.test.mjs). The fix is to hand the list the entitlement rule itself rather than a
// second copy of it, so this test is worth nothing unless it runs against a genuine rest day: the
// member is one whose line rests on Sat 5 Dec 2026 and works Mon 7 – Fri 11, which no fixture here
// asserts and a roster edit could change. The first assertion below therefore pins the PREMISE — if
// no line has that shape any more, this fails loudly as a stale test rather than measuring nothing.
const REST_SAT_MEMBER = teamMembers.find(m => m.role === 'CEA' && !m.hidden && !m.managerOnly && !m.startDate
    && m.name !== 'G. Miller'
    && isRestShift(getBaseShift(m, parseISODate('2026-12-05')))
    // Named shifts, not Spare: a Spare week's fifth day costs nothing since 21 Nov 2026, which is
    // the next test's subject and would move this one's count.
    && ['07', '08', '09', '10', '11'].every(d => { const b = getBaseShift(m, parseISODate(`2026-12-${d}`)); return !isRestShift(b) && b !== 'SPARE'; }))?.name;
// CHRISTMAS LEAVE IS PART OF THESE LISTS (v25.37, owner 5 Nov 2026): a member due at work on 25/26
// December has a 🎄 row in that year's Recorded Annual Leave, which is a record and not a booking. The
// tests below are about BOOKINGS, so they count `BOOKED_ROWS`, and pin the clock — the Christmas rows
// listed run up to the current year, so a real clock would change what these lists hold every January.
const BOOKED_ROWS = '#alBookedBody .al-period-row:not(.al-period-row--christmas)';

test('admin: an AL day on a REST day is not listed and does not count', async ({ page }) => {
    // THE PREMISE, asserted before anything is measured against it.
    expect(REST_SAT_MEMBER, 'no CEA line rests on Sat 5 Dec 2026 and works Mon 7 – Fri 11 — this test proves nothing').toBeTruthy();
    const who = /** @type {string} */ (REST_SAT_MEMBER);
    await page.clock.setFixedTime(new Date('2026-11-05T09:00:00Z'));
    await seedSession(page, 'G. Miller');
    await page.addInitScript((name) => {
        /** @type {any} */ (window).__E2E = Object.assign(/** @type {any} */ (window).__E2E || {}, {
            docs: [
                // Sat 5 Dec — the rest day. Recorded, and spends nothing.
                { id: 'r1', memberName: name, date: '2026-12-05', type: 'annual_leave', value: 'AL', note: '' },
                // Mon 7 – Fri 11 — the leave actually taken.
                ...['07', '08', '09', '10', '11'].map((d, i) =>
                    ({ id: `r${i + 2}`, memberName: name, date: `2026-12-${d}`, type: 'annual_leave', value: 'AL', note: '' })),
            ],
        });
    }, who);
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });

    // The premise again, in the PAGE's copy of the roster: the one the list actually reads.
    const premise = await page.evaluate(async (name) => {
        const rd = await import('./roster-data.js');
        const m = rd.teamMembers.find(x => x.name === name);
        return { five: String(rd.getBaseShift(m, rd.parseISODate('2026-12-05'))),
                 seven: String(rd.getBaseShift(m, rd.parseISODate('2026-12-07'))) };
    }, who);
    expect(premise.five, 'Sat 5 Dec 2026 must be a REST day on the chosen line, or this test proves nothing')
        .toMatch(/^(RD|OFF)$/);
    expect(premise.seven, 'Mon 7 Dec 2026 must be a working day, or the expected period is wrong')
        .not.toMatch(/^(RD|OFF)$/);

    await page.locator('#fieldMember').selectOption(who);
    await page.locator('#alToggleHeader').click();
    await expect(page.locator('#alBookedBox')).toBeVisible();
    await page.locator('#alBookedToggle').click();
    await expect(page.locator('#alBookedBody')).toBeVisible();

    const rows = page.locator(BOOKED_ROWS);
    await expect(rows).toHaveCount(1);
    // The range STARTS on the Monday — a period opening on the rest day is the defect, and it is
    // visible in the dates even when the count happens to be right.
    await expect(rows.first().locator('.al-period-dates')).toHaveText('Mon 7 – Fri 11 Dec');
    await expect(rows.first().locator('.al-period-count')).toHaveText('5 days');
});

// A SPARE WEEK USES AT MOST FOUR (owner, 21 Nov 2026), AND THE LIST STILL SHOWS THE WHOLE WEEK. The
// first cut listed only what was charged, so a whole Spare week off read "Mon – Thu, 4 days" while the
// member was off on the Friday and Saturday too. Listed in full, counted as four, and said why.
test('admin: a whole Spare week off is listed in full and counted as four days', async ({ page }) => {
    const pick = teamMembers.map(m => {
        if (m.role !== 'CEA' || m.hidden || m.managerOnly || m.startDate) return null;
        for (let d = new Date(2026, 10, 9); d < new Date(2026, 11, 19); d.setDate(d.getDate() + 1)) {   // inside 2026's list
            if (d.getDay() !== 1) continue;
            const week = Array.from({ length: 6 }, (_, k) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + k));
            if (week[5].getMonth() !== d.getMonth()) continue;
            if (week.every(x => getBaseShift(m, x) === 'SPARE' && !isBankHoliday(x))) return { name: m.name, week: week.map(x => formatISO(x)) };
        }
        return null;
    }).find(Boolean);
    expect(pick, 'no CEA has a whole Spare week inside one month between 9 Nov and 19 Dec 2026').toBeTruthy();
    const p = /** @type {any} */ (pick);
    await page.clock.setFixedTime(new Date('2026-11-05T09:00:00Z'));
    await seedSession(page, 'G. Miller');
    await page.addInitScript(([name, week]) => {
        /** @type {any} */ (window).__E2E = Object.assign(/** @type {any} */ (window).__E2E || {}, {
            docs: /** @type {string[]} */ (week).map((date, i) => ({ id: `sw${i}`, memberName: name, date, type: 'annual_leave', value: 'AL', note: '' })),
        });
    }, [p.name, p.week]);
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    await page.locator('#fieldMember').selectOption(p.name);
    await page.locator('#alToggleHeader').click();
    await expect(page.locator('#alBookedBox')).toBeVisible();
    await page.locator('#alBookedToggle').click();
    await expect(page.locator('#alBookedBody')).toBeVisible();

    const rows = page.locator(BOOKED_ROWS);
    await expect(rows).toHaveCount(1);
    await expect(rows.first().locator('.al-period-count')).toHaveText('4 days');
    await expect(rows.first().locator('.al-period-note')).toHaveText('2 Spare days not counted — a Spare week uses at most 4');
    const dates = (await rows.first().locator('.al-period-dates').textContent()) ?? '';
    expect(dates, 'the period runs Monday to Saturday — the member is off all week').toMatch(/^Mon \d+ – Sat \d+/);
});

// ── THE RECORDED-DATES LIST IS PER YEAR (v23.09, owner report) ──────────────────────────────────
//
// The owner's own card ran January 2026 to June 2027 in one scroll — fifteen bookings, every month
// header repeating the year because nothing else on the card said which one a row was in. The rules
// are unit-tested in admin-booked-periods.test.mjs; this is the WIRING, which is the half that
// fails in practice: a chip that renders but filters nothing, or a chip offered for a year with no
// bookings, which shows an empty list and reads as "nothing recorded for this member".

// ── CHRISTMAS LEAVE IS ON RECORD, NEVER COUNTED (v25.37, owner 5 Nov 2026) ──────────────────────
//
// The owner asked for it to be RECORDED in the leave records, not merely shown. Nothing is stored
// for it — it comes from the roster — so the row carries no count and no delete, and it sits in date
// order among the real bookings. The member is due at work on both days in 2026 and the fixture has
// them work Boxing Day, so only Christmas Day is leave. The day in lieu that earns is in 2027's
// allowance, not 2026's (owner, 15 Nov 2026), so the 2026 banner is the contract figure; the test after
// this one reads 2027.
//
// The member is chosen by SHAPE, never by name: these tests assert leave figures, and the Pages mirror
// serves this file (payroll-anonymity.test.mjs). A plain-contract CEA with no joining year, change of
// grade or change of line, whose PATTERN has a timed turn on 25 and 26 December 2026 and a working
// Monday on the 21st — so the contract figure is the CEA one and every day below means what it says.
const XMAS_MEMBER = teamMembers.find(m => m.role === 'CEA' && !m.hidden && !m.managerOnly && m.name !== 'G. Miller'
    && !m.startDate && !m.proRatedAL && m.bilingualContract !== true && !m.roleHistory && !m.rosterChanges
    && [25, 26].every(d => /^\d\d:\d\d-/.test(String(getPatternShift(m, new Date(2026, 11, d)))))
    && !isRestShift(getBaseShift(m, parseISODate('2026-12-21'))))?.name;

test('admin: Christmas leave is listed with the recorded leave, not counted, with nothing to delete', async ({ page }) => {
    expect(XMAS_MEMBER, 'premise: a CEA due at work on 25 and 26 December 2026 on a plain contract').toBeTruthy();
    const who = /** @type {string} */ (XMAS_MEMBER);
    await page.clock.setFixedTime(new Date('2026-12-10T09:00:00Z'));
    await seedSession(page, 'G. Miller');
    await page.addInitScript((name) => {
        /** @type {any} */ (window).__E2E = Object.assign(/** @type {any} */ (window).__E2E || {}, {
            docs: [
                { id: 'a1', memberName: name, date: '2026-12-21', type: 'annual_leave', value: 'AL', note: '' },
                { id: 'bx', memberName: name, date: '2026-12-26', type: 'rdw', value: '13:30-21:00', note: '' },
            ],
        });
    }, who);
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    await page.locator('#fieldMember').selectOption(who);
    await page.locator('#alToggleHeader').click();
    await expect(page.locator('#alBookedBox')).toBeVisible();
    await page.locator('#alBookedToggle').click();
    await expect(page.locator('#alBookedBody')).toBeVisible();

    const rows = page.locator('#alBookedBody .al-period-row');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).not.toHaveClass(/al-period-row--christmas/);
    const xmas = rows.nth(1);
    await expect(xmas).toHaveClass(/al-period-row--christmas/);
    await expect(xmas.locator('.al-period-dates')).toContainText('25 Dec');
    // Laid out like every other row (v25.38): the day count in the pill column — outlined, not
    // filled — and what makes it different on a second line under the dates.
    // One day: the member works the Boxing Day they were due to work, so only Christmas Day is leave.
    await expect(xmas.locator('.al-period-free')).toHaveText('1 day');
    await expect(xmas.locator('.al-period-note')).toContainText('Not counted');
    await expect(xmas.locator('.al-period-note')).toBeVisible();
    await expect(xmas.locator('button'), 'nothing is stored, so there is nothing to delete').toHaveCount(0);
    // The real booking still counts one day — the Christmas row added nothing to it.
    await expect(rows.nth(0).locator('.al-period-count')).toHaveText('1 day');

    await expect(page.locator('#alBannerEntitlement')).toHaveText('32');
    await expect(page.locator('#alBannerTaken')).toHaveText('0');
    await expect(page.locator('#alBannerBooked')).toHaveText('1');
    await expect(page.locator('#alBannerBreakdown'), 'the day in lieu is 2027\'s, so 2026 has nothing to explain').toBeHidden();
});

// THE DAY IN LIEU CAN BE TAKEN FROM 27 DECEMBER (owner, 25 Nov 2026). With the year's allowance used up and Boxing Day
// worked, leave on a day after it is covered by the day in lieu: no "over allowance" bar, and the 2026 banner says
// what the extra day is. Through the real booking path, because the rule is only as good as the count Admin asks.
// Chosen by shape, like XMAS_MEMBER, with a working day between 28 and 31 December 2026 to take as leave.
const LATE_DEC = [28, 29, 30, 31].map(day => new Date(2026, 11, day));
const timedOn = (/** @type {any} */ m, /** @type {Date} */ d) => d.getDay() !== 0 && /^\d\d:\d\d-/.test(String(getBaseShift(m, d)));
const LIEU_MEMBER = teamMembers.find(m => m.role === 'CEA' && !m.hidden && !m.managerOnly && m.name !== 'G. Miller'
    && !m.startDate && !m.proRatedAL && m.bilingualContract !== true && !m.roleHistory && !m.rosterChanges
    && /^\d\d:\d\d-/.test(String(getPatternShift(m, new Date(2026, 11, 26)))) && LATE_DEC.some(d => timedOn(m, d)))?.name;

test('admin: leave after a worked Boxing Day, past the year\'s allowance, takes the day in lieu — not "over"', async ({ page }) => {
    test.setTimeout(40_000);
    expect(LIEU_MEMBER, 'premise: a CEA due at work on Boxing Day 2026, working a day from 28 December, on a plain contract').toBeTruthy();
    const who = /** @type {string} */ (LIEU_MEMBER);
    const m = /** @type {any} */ (teamMembers.find(t => t.name === who));
    const iso = (/** @type {Date} */ d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const timed = (/** @type {Date} */ d) => timedOn(m, d);
    /** @type {string[]} */ const leave = [];
    for (let d = new Date(2026, 0, 5); leave.length < 32; d.setDate(d.getDate() + 1)) if (timed(d)) leave.push(iso(d));
    const late = LATE_DEC.find(timed);
    const lateIso = iso(/** @type {Date} */ (late));
    await page.clock.setFixedTime(new Date('2026-12-10T09:00:00Z'));
    await seedSession(page, 'G. Miller');
    await page.addInitScript(([name, days]) => {
        /** @type {any} */ (window).__E2E = Object.assign(/** @type {any} */ (window).__E2E || {}, {
            authUser: true,   // the save needs a signed-in account
            docs: [
                ...days.map((date, i) => ({ id: 'al' + i, memberName: name, date, type: 'annual_leave', value: 'AL', note: '', source: 'manual' })),
                { id: 'bx', memberName: name, date: '2026-12-26', type: 'rdw', value: '13:30-21:00', note: '', source: 'manual' },
            ],
        });
    }, /** @type {[string, string[]]} */ ([who, leave]));
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    await page.locator('#fieldMember').selectOption(who);
    await page.locator('#alToggleHeader').click();
    await expect(page.locator('#alBannerEntitlement')).toHaveText('32');
    await expect(page.locator('#alBannerTaken'), 'the year\'s 32 days are all taken by 10 December').toHaveText('32');
    await expect(page.locator('#alRangePicker')).toBeVisible();   // open on December: the clock is 10 December
    await page.locator(`#alRpGrid .rp-day[data-iso="${lateIso}"]`).click();
    await page.locator(`#alRpGrid .rp-day[data-iso="${lateIso}"]`).click();
    await expect(page.locator('#alPreview')).toBeVisible();
    await expect(page.locator('#alPreview'), 'covered by the day in lieu').not.toContainText('over');
    await clickInView(page.locator('#alSaveBtn'));
    await expect(page.locator('#alFeedback'), 'saved without an "over allowance" question').toContainText('Recorded');
    await expect(page.locator('#alConfirmBar')).not.toHaveClass(/visible/);
    await expect(page.locator('#alBannerEntitlement')).toHaveText('33');
    await expect(page.locator('#alBannerBreakdown'))
        .toHaveText('Includes 1 day in lieu for working Boxing Day 2026, taken on leave after it that December');
});

// The note under ENTITLEMENT is a 50-character sentence about Boxing Day 2026, and it was `nowrap`: the
// fourth figure grew as wide as the sentence and the four ran out of the banner, where the card's
// `overflow: hidden` cut them ("…for working B") — so a TEXT test stayed green on a note nobody could
// finish reading. Geometry, at a phone's widths and in the desktop side column. In January 2027,
// because that year's allowance is the one holding the day (owner, 15 Nov 2026).
test('admin: the AL banner keeps its figures and the Boxing Day note inside the banner', async ({ page }) => {
    expect(XMAS_MEMBER, 'premise: a CEA due at work on Boxing Day 2026 on a plain contract').toBeTruthy();
    const who = /** @type {string} */ (XMAS_MEMBER);
    await page.clock.setFixedTime(new Date('2027-01-05T09:00:00Z'));
    await seedSession(page, 'G. Miller');
    await page.addInitScript((name) => {
        /** @type {any} */ (window).__E2E = Object.assign(/** @type {any} */ (window).__E2E || {}, {
            docs: [{ id: 'bx', memberName: name, date: '2026-12-26', type: 'rdw', value: '13:30-21:00', note: '' }],
        });
    }, who);
    await page.setViewportSize({ width: 375, height: 900 });
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    await page.locator('#fieldMember').selectOption(who);
    await page.locator('#alToggleHeader').click();
    await expect(page.locator('#alBannerLblEntitlement')).toHaveText('2027 allowance');
    await expect(page.locator('#alBannerEntitlement')).toHaveText('33');
    await expect(page.locator('#alBannerBreakdown')).toHaveText('Includes 1 day in lieu for working Boxing Day 2026');
    for (const width of [360, 375, 1024]) {
        await page.setViewportSize({ width, height: 900 });
        const m = await page.locator('#alBanner').evaluate(banner => {
            const edge = banner.getBoundingClientRect().right - parseFloat(getComputedStyle(banner).borderRightWidth);
            const right = (/** @type {Element} */ el) => el.getBoundingClientRect().right;
            return {
                edge,
                overflow: banner.scrollWidth - banner.clientWidth,
                stats: [...banner.querySelectorAll('.al-banner-stat')].map(right),
                note: right(/** @type {Element} */ (banner.querySelector('#alBannerBreakdown'))),
            };
        });
        expect(m.overflow, `${width}px: the banner's content is wider than the banner`).toBeLessThanOrEqual(0);
        for (const r of [...m.stats, m.note]) {
            expect(r, `${width}px: a figure or the note runs past the banner's edge (${m.edge}px)`).toBeLessThanOrEqual(m.edge + 0.5);
        }
    }
    // …and it is read, so it is quieter by its size, never by a fade: at `opacity: 0.75` it was 3.47:1.
    const note = await page.locator('#alBannerBreakdown').evaluate(el => {
        const ctx = /** @type {CanvasRenderingContext2D} */ (document.createElement('canvas').getContext('2d', { willReadFrequently: true }));
        /** @param {string} css */
        const rgb = (css) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = css; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3); };
        /** @param {number[]} c */
        const lum = (c) => c.map(v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; })
            .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
        const [hi, lo] = [lum(rgb(getComputedStyle(el).color)),
            lum(rgb(getComputedStyle(/** @type {Element} */ (el.closest('.al-banner'))).backgroundColor))].sort((x, y) => y - x);
        return { opacity: getComputedStyle(el).opacity, ratio: (hi + 0.05) / (lo + 0.05) };
    });
    expect(note.opacity, 'the entitlement note is faded with opacity').toBe('1');
    expect(note.ratio, 'the entitlement note is under the 4.5:1 text floor').toBeGreaterThanOrEqual(4.5);
});

test('admin: the recorded-dates list shows one year at a time, and only years that have leave',
    async ({ page }) => {
        await page.clock.setFixedTime(new Date('2026-11-05T09:00:00Z'));
        await seedSession(page, 'G. Miller');
        await page.addInitScript(() => {
            /** @type {any} */ (window).__E2E = Object.assign(/** @type {any} */ (window).__E2E || {}, {
                docs: [
                    // Two years apart, so a list that ignored the year would show all three rows.
                    { id: 'a1', memberName: 'G. Miller', date: '2026-03-02', type: 'annual_leave', value: 'AL', note: '' },
                    { id: 'a2', memberName: 'G. Miller', date: '2026-03-03', type: 'annual_leave', value: 'AL', note: '' },
                    // A GAP YEAR IS THE POINT: 2026 and 2028, nothing in 2027. Adjacent years would
                    // make the "no empty chip" assertion below unfalsifiable — a chip row built
                    // from a min→max range would produce exactly the right answer by accident.
                    { id: 'b1', memberName: 'G. Miller', date: '2028-06-22', type: 'annual_leave', value: 'AL', note: '' },
                ],
            });
        });
        await page.goto('/admin.html');
        await page.waitForSelector('.day-row', { timeout: 10000 });
        await page.locator('#fieldMember').selectOption('G. Miller');
        await page.locator('#alToggleHeader').click();
        await expect(page.locator('#alBookedBox')).toBeVisible();
        // The dates box is a collapsible INSIDE the card and ships closed, so its body is
        // `display: none` until this. Without it every assertion below still passes — `toHaveText`
        // and `evaluateAll` both read hidden nodes — and the test would prove nothing about a list
        // anybody can see.
        await page.locator('#alBookedToggle').click();
        await expect(page.locator('#alBookedBody')).toBeVisible();

        const chips = page.locator('#alBookedBody .al-year-chip');
        await expect(chips).toHaveText(['2026', '2028']);
        // A YEAR WITH NO BOOKINGS MUST NEVER GET A CHIP. 2027 sits between the two that have one,
        // so it is exactly what a chip row built from a min→max range would invent — and its empty
        // list would read as "no leave recorded", about a member who has plenty.
        await expect(chips.filter({ hasText: '2027' })).toHaveCount(0);

        // One year at a time: the 2027 booking is not on screen while 2026 is selected.
        const rows = page.locator(`${BOOKED_ROWS} .al-period-dates`);
        await expect(rows).toHaveCount(1);
        await expect(rows.first()).toContainText('Mar');

        // And the month header no longer repeats the year — the chip owns it.
        await expect(page.locator('#alBookedBody .al-period-month-hdr').first()).toHaveText('Mar');

        await chips.filter({ hasText: '2028' }).click();
        await expect(rows).toHaveCount(1);
        await expect(rows.first()).toContainText('Jun');
        await expect(chips.filter({ hasText: '2028' })).toHaveAttribute('aria-pressed', 'true');
    });

test('admin: a booking that crosses the year end appears in BOTH years, cut at the boundary', async ({ page }) => {
    // The owner's own leave: Mon 28 Dec → Fri 1 Jan. Filed under the year it started, the January
    // day vanished from 2027 — the year a member opens to see what leave they have in it.
    await page.clock.setFixedTime(new Date('2026-11-05T09:00:00Z'));
    await seedSession(page, 'G. Miller');
    await page.addInitScript(() => {
        /** @type {any} */ (window).__E2E = Object.assign(/** @type {any} */ (window).__E2E || {}, {
            docs: ['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01'].map((date, i) =>
                ({ id: 'x' + i, memberName: 'G. Miller', date, type: 'annual_leave', value: 'AL', note: '' })),
        });
    });
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    await page.locator('#fieldMember').selectOption('G. Miller');
    await page.locator('#alToggleHeader').click();
    await page.locator('#alBookedToggle').click();
    await expect(page.locator('#alBookedBody')).toBeVisible();

    const chips = page.locator('#alBookedBody .al-year-chip');
    await expect(chips, 'both years must get a chip').toHaveText(['2026', '2027']);

    const rows = page.locator(BOOKED_ROWS);
    // The banner's year is 2026 in this fixture's clock, so the list opens there.
    await chips.filter({ hasText: '2026' }).click();
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('Mon 28 – Thu 31 Dec');
    await expect(rows.first().locator('.al-period-count')).toHaveText('4 days');
    await expect(rows.first().locator('.al-period-cont')).toContainText(/continues to Fri 1 Jan 2027/);

    await chips.filter({ hasText: '2027' }).click();
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('Fri 1 Jan');
    await expect(rows.first().locator('.al-period-count')).toHaveText('1 day');
    await expect(rows.first().locator('.al-period-cont')).toContainText(/continued from Mon 28 Dec 2026/);
    // And it stays ONE line — the sentence version wrapped the pill and the ✕ under the date.
    const h = await rows.first().evaluate(el => el.getBoundingClientRect().height);
    expect(h, 'a continued row must not wrap to two lines at 375px').toBeLessThan(56);
    // And the delete control names ONLY its own piece — removing 1 Jan must not offer to take
    // December with it.
    await expect(rows.first().locator('.btn-period-delete')).toHaveAttribute('aria-label', /^Delete Fri 1 Jan$/);
});

test('admin: each delete control is named by the dates it would remove', async ({ page }) => {
    await page.clock.setFixedTime(LEAVE_LIST_DAY);
    // Fifteen buttons all announcing "Delete" told a screen-reader user nothing about which row
    // they were on, and the compact ✕ that replaced the word has no name of its own at all.
    await seedSession(page, 'G. Miller');
    await page.addInitScript(() => {
        /** @type {any} */ (window).__E2E = Object.assign(/** @type {any} */ (window).__E2E || {}, {
            docs: [
                { id: 'a1', memberName: 'G. Miller', date: '2026-03-02', type: 'annual_leave', value: 'AL', note: '' },
                { id: 'b1', memberName: 'G. Miller', date: '2026-05-12', type: 'annual_leave', value: 'AL', note: '' },
            ],
        });
    });
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    await page.locator('#fieldMember').selectOption('G. Miller');
    await page.locator('#alToggleHeader').click();
    await page.locator('#alBookedToggle').click();
    await expect(page.locator('#alBookedBody')).toBeVisible();

    const names = await page.locator('#alBookedBody .btn-period-delete')
        .evaluateAll(els => els.map(e => e.getAttribute('aria-label')));
    expect(names.length, 'the fixture should produce two separate bookings').toBe(2);
    expect(new Set(names).size, 'two rows must not share one name').toBe(2);
    for (const n of names) expect(n).toMatch(/^Delete \w{3} \d+/);
});

test('admin: a refused delete leaves the ✕ as a ✕, not the word it used to be', async ({ page }) => {
    await page.clock.setFixedTime(LEAVE_LIST_DAY);
    // THE REGRESSION THE FIRST CUT SHIPPED WITH. The coordinator restored the delete control to the
    // label it remembered — the word "Delete" — into a 44px square built for a glyph, with the
    // aria-label still reading "Confirm". Invisible on a SUCCESSFUL delete (the row is gone before
    // anyone sees it), so it is pinned on a path where the row stays: a session the app believes
    // in but Firebase does not, which `seedSession` alone produces — there is no restored user.
    await seedSession(page, 'G. Miller');
    await page.addInitScript(() => {
        /** @type {any} */ (window).__E2E = Object.assign(/** @type {any} */ (window).__E2E || {}, {
            docs: [{ id: 'a1', memberName: 'G. Miller', date: '2026-03-02', type: 'annual_leave', value: 'AL', note: '' }],
        });
    });
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    await page.locator('#fieldMember').selectOption('G. Miller');
    await page.locator('#alToggleHeader').click();
    await page.locator('#alBookedToggle').click();

    const btn = page.locator('#alBookedBody .btn-period-delete').first();
    await expect(btn).toHaveText('✕');
    await btn.click();
    await expect(btn, 'first tap asks').toHaveText('Delete?');
    await pastDoubleTap(page);
    await btn.click();
    // The refusal is what proves the path was the refused one and not a silent success.
    await expect(page.locator('#alFeedback')).toContainText(/signed out/i);
    // ONE SECOND, NOT THE DEFAULT FIVE. The confirm state also expires on its own after 5s, and
    // the first cut of this assertion waited that long — so a build that never restored the
    // control at all passed, with the auto-expiry doing the restoring just inside the window.
    // Measured by mutation. A restore driven by the delete SETTLING is immediate; anything that
    // takes longer than a second here is the timer, and the timer is not what is under test.
    await expect(btn, 'the row is still here, so the control must be idle again — at once')
        .toHaveText('✕', { timeout: 1000 });
    await expect(btn).toHaveAttribute('aria-label', /^Delete /);
    await expect(btn).not.toHaveClass(/confirming/);
});

test('admin: choosing a year from the keyboard keeps focus on the year you chose', async ({ page }) => {
    // Activating a chip re-renders the whole list, and a focused node that is removed hands focus
    // to <body> — so Enter would drop a keyboard user at the top of the page with nothing to say
    // which year they had just picked. Pointer users never see this: nothing they are touching is
    // the thing that disappears.
    await seedSession(page, 'G. Miller');
    await page.addInitScript(() => {
        /** @type {any} */ (window).__E2E = Object.assign(/** @type {any} */ (window).__E2E || {}, {
            docs: [
                { id: 'a1', memberName: 'G. Miller', date: '2026-03-02', type: 'annual_leave', value: 'AL', note: '' },
                { id: 'b1', memberName: 'G. Miller', date: '2028-06-22', type: 'annual_leave', value: 'AL', note: '' },
            ],
        });
    });
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    await page.locator('#fieldMember').selectOption('G. Miller');
    await page.locator('#alToggleHeader').click();
    await page.locator('#alBookedToggle').click();

    const later = page.locator('#alBookedBody .al-year-chip').filter({ hasText: '2028' });
    await later.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#alBookedBody .al-year-chip.is-active')).toHaveText('2028');
    const focused = await page.evaluate(() => {
        const a = /** @type {any} */ (document.activeElement);
        return a ? { cls: a.className, text: a.textContent } : null;
    });
    expect(focused?.cls, 'focus must still be on a year chip').toMatch(/al-year-chip/);
    expect(focused?.text, 'and on the one that was chosen').toBe('2028');
});

// ── SAVED CHANGES ROWS ARE ROWS (v23.12, owner review) ──────────────────────────────────────────
//
// Measured before the change at 375px: 76px on a desktop pointer and ~110px on a phone, for two
// lines of 13px text — because Edit and Delete were stacked in a column and the touch block raised
// each to 36px, so the actions cluster set the height of every row. The recorded-dates list beside
// it had just been brought to 46px. This pins the shape that fixed it: the two controls side by
// side at 44px, the row no taller than the pair of them plus its padding, and the member's name
// stated once at the top rather than on every row of a single-member list.

// ── THE WIRING AROUND THE YEAR SELECTOR (v23.15 review) ──────────────────────────────────────────
//
// The three rungs of `pickBookedYear` are unit-tested; these are the three places the coordinator
// has to FEED it, none of which had a test — and one of which was wrong: scrolling the range picker
// into another year moved the banner and left the list on the old year, because `onViewYearChange`
// re-ran the banner and not the list. The rule tested, the wiring not.

/** Two members, each with leave in 2026 and 2028, so a pinned 2028 is a year the SECOND member also
 *  has — the only shape that can tell "the pin was cleared" from "the pin fell off a year that was
 *  not there". @param {import('@playwright/test').Page} page */
async function seedTwoMembersTwoYears(page) {
    await page.addInitScript(() => {
        /** @type {any} */ (window).__E2E = Object.assign(/** @type {any} */ (window).__E2E || {}, {
            docs: [
                { id: 'g1', memberName: 'G. Miller', date: '2026-03-02', type: 'annual_leave', value: 'AL', note: '' },
                { id: 'g2', memberName: 'G. Miller', date: '2028-06-22', type: 'annual_leave', value: 'AL', note: '' },
                { id: 's1', memberName: 'S. Silva',  date: '2026-04-06', type: 'annual_leave', value: 'AL', note: '' },
                { id: 's2', memberName: 'S. Silva',  date: '2028-07-13', type: 'annual_leave', value: 'AL', note: '' },
            ],
        });
    });
}

test('admin: a year chosen for one member is not carried over to the next', async ({ page }) => {
    await page.clock.setFixedTime(LEAVE_LIST_DAY);
    await seedSession(page, 'G. Miller');
    await seedTwoMembersTwoYears(page);
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    await page.locator('#fieldMember').selectOption('G. Miller');
    await page.locator('#alToggleHeader').click();
    await page.locator('#alBookedToggle').click();
    await expect(page.locator('#alBookedBody')).toBeVisible();

    const active = page.locator('#alBookedBody .al-year-chip.is-active');
    await expect(active, 'opens on the year the banner describes').toHaveText('2026');
    // The chips meet the same 44px target as every other control on the card (v23.15) — they
    // shipped at 36px, the only new control under the standard its neighbours meet.
    expect((await active.boundingBox())?.height ?? 0, 'a year chip is a 44px target').toBeGreaterThanOrEqual(44);
    await page.locator('#alBookedBody .al-year-chip', { hasText: '2028' }).click();
    await expect(active, 'the tap pins 2028').toHaveText('2028');

    // Switch member. S. Silva HAS 2028 leave, so if the pin survived the switch the list would open
    // on 2028 — a year the reader chose about somebody else.
    await page.locator('#fieldMember').selectOption('S. Silva');
    await expect(page.locator('#alBookedBody .al-year-chip')).toHaveText(['2026', '2028']);
    await expect(active, 'a new member starts from the banner year, not the last pin').toHaveText('2026');
    await expect(page.locator('#alBookedBody .al-period-dates').first()).toContainText('Apr');
});

// The Calendar's leave panel links to ONE year (v24.46): `?alYear=2028` must open the list on 2028
// even though the banner (and so the list's own default) is on 2026.
test('admin: a link naming a year opens the recorded-leave list on that year', async ({ page }) => {
    await seedSession(page, 'G. Miller');
    await seedMember(page, 'G. Miller');
    await seedTwoMembersTwoYears(page);
    await page.goto('/admin.html?alYear=2028#alBookedBox');
    await expect(page.locator('#alBookedBox')).toBeVisible();
    await expect(page.locator('#alBookedBody .al-year-chip.is-active')).toHaveText('2028');
    await expect(page.locator('#alBookedBody .al-period-dates').first()).toContainText('Jun');
});

// 2025, not 2027: from 2026 G. Miller has Christmas leave EVERY year (his pattern has him at work on
// 25/26 December), and a year holding Christmas leave is not empty — the test below is about that.
// 2025 is before the Christmas rules, so it is genuinely a year with no leave in it.
test('admin: a linked year with no leave in it falls back, never to an empty list', async ({ page }) => {
    await page.clock.setFixedTime(LEAVE_LIST_DAY);
    await seedSession(page, 'G. Miller');
    await seedMember(page, 'G. Miller');
    await seedTwoMembersTwoYears(page);
    await page.goto('/admin.html?alYear=2025#alBookedBox');
    await expect(page.locator('#alBookedBox')).toBeVisible();
    await expect(page.locator('#alBookedBody .al-year-chip.is-active')).toHaveText('2026');
});

// 6 Nov 2026 review: the Calendar's "Leave dates" link from 25 Dec 2027 names 2027. With nothing else
// booked that year the list fell back to 2026, and the day just tapped was not on it — because the
// list's Christmas leave stopped at this calendar year. A year the reader asked for shows its own.
test('admin: a linked year holding only Christmas leave opens on its Christmas row', async ({ page }) => {
    await seedSession(page, 'G. Miller');
    await seedMember(page, 'G. Miller');
    await seedTwoMembersTwoYears(page);
    await page.goto('/admin.html?alYear=2027#alBookedBox');
    await expect(page.locator('#alBookedBox')).toBeVisible();
    await expect(page.locator('#alBookedBody .al-year-chip.is-active')).toHaveText('2027');
    await expect(page.locator('#alBookedBody .al-period-row--christmas')).toContainText('Not counted');
});

test('admin: scrolling the date picker into another year moves the list with the banner', async ({ page }) => {
    await page.clock.setFixedTime(LEAVE_LIST_DAY);   // "this year" is 2026, where the fixture's first booking is
    // The banner follows the picker's displayed year (v22.82); the list is meant to follow the
    // banner (pickBookedYear's `preferred` rung). Until v23.15 only the banner was re-run.
    await seedSession(page, 'G. Miller');
    await page.addInitScript(() => {
        /** @type {any} */ (window).__E2E = Object.assign(/** @type {any} */ (window).__E2E || {}, {
            docs: [
                { id: 'a1', memberName: 'G. Miller', date: '2026-03-02', type: 'annual_leave', value: 'AL', note: '' },
                // BOTH DATES MUST BE WORKING DAYS ON HIS LINE. The list only shows leave that
                // spends entitlement (v23.72), so a fixture date that happens to fall on a rest day
                // is dropped — and this test then fails for a reason that has nothing to do with
                // what it checks. It did: this was 22 Jun 2027, which is a rest day for G. Miller,
                // so the 2027 chip vanished and the failure read like a broken year selector.
                // 8 Jun is a working day, and the premise is asserted below rather than trusted.
                { id: 'a2', memberName: 'G. Miller', date: '2027-06-08', type: 'annual_leave', value: 'AL', note: '' },
            ],
        });
    });
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });

    // The premise, so a roster edit that moves his line fails loudly here instead of quietly
    // deleting the year this test is about.
    const bothWork = await page.evaluate(async () => {
        const [rd, al] = await Promise.all([import('./roster-data.js'), import('./al-entitlement.js')]);
        const m = rd.teamMembers.find(x => x.name === 'G. Miller');
        return ['2026-03-02', '2027-06-08'].map(d => al.consumesEntitlement(m, d, null));
    });
    expect(bothWork, 'both seeded AL dates must be working days for G. Miller').toEqual([true, true]);

    await page.locator('#fieldMember').selectOption('G. Miller');
    await page.locator('#alToggleHeader').click();
    await page.locator('#alBookedToggle').click();
    await expect(page.locator('#alBookedBody')).toBeVisible();

    const active = page.locator('#alBookedBody .al-year-chip.is-active');
    await expect(active).toHaveText(String(LEAVE_LIST_DAY.getFullYear()));

    // Page the range picker forward until it is showing a month of NEXT year.
    const next = page.locator('#alRpNext');
    const label = page.locator('#alRpLabel');
    const target = String(LEAVE_LIST_DAY.getFullYear() + 1);
    for (let i = 0; i < 14 && !(await label.textContent() || '').includes(target); i++) await next.click();
    await expect(label, 'the picker must actually be showing next year').toContainText(target);

    // The banner carries its year only in its FIGURES (which year the 32 is counted against), so
    // the list's chip is the one visible statement of the year on this card — and it must agree
    // with what the figures now describe.
    await expect(active, 'the list follows the picker, as the banner does').toHaveText(target);
    await expect(page.locator('#alBookedBody .al-period-dates').first()).toContainText('Jun');
});

test('admin: deleting a recorded booking confirms in the toast, not only at the top of the card', async ({ page }) => {
    // The inline feedback sits at the top of the card; the row that was deleted can be a screen
    // below it. A destructive action whose confirmation lands off-screen is one the admin repeats.
    // Pinned to 2025, before the first Christmas leave: from 2026 G. Miller's list also holds his
    // 🎄 row, so deleting the one booking would no longer empty it, which is the end this checks.
    await page.clock.setFixedTime(new Date('2025-11-05T09:00:00Z'));
    await seedMemberSession(page, 'G. Miller');   // a real user, so the delete is not refused
    await page.addInitScript(() => {
        /** @type {any} */ (window).__E2E = Object.assign(/** @type {any} */ (window).__E2E || {}, {
            docs: [{ id: 'a1', memberName: 'G. Miller', date: '2026-03-02', type: 'annual_leave', value: 'AL', note: '' }],
        });
    });
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    await page.locator('#fieldMember').selectOption('G. Miller');
    await page.locator('#alToggleHeader').click();
    await page.locator('#alBookedToggle').click();

    const btn = page.locator('#alBookedBody .btn-period-delete').first();
    await btn.click();
    await expect(btn).toHaveText('Delete?');
    await pastDoubleTap(page);
    await btn.click();

    const toast = page.locator('#saveToast');
    await expect(toast).toHaveClass(/visible/);
    await expect(toast).toHaveText(/Deleted 1 day of Annual Leave for G\. Miller/);
    // And the row is gone: with no leave left the box hides rather than showing an empty year.
    await expect(page.locator('#alBookedBox')).toBeHidden();
});

// A RECORDED DATES DELETE ASKS THE OVER-ALLOWANCE QUESTION (external review of v26.58), as Saved Changes' ✕ does. A
// Spare week over New Year spends its four from its December days, so deleting 28–31 December moves the charge onto
// 1 and 2 January: with 2027 one day short of full, it ends one over. The list's ✕ deleted at once, with no question.
// An INVENTED member, Spare that week, with 2027's other leave on their working days.
const NY_SPARE = ['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02'];
/** @param {import('@playwright/test').Page} page @param {{ server?: (rows: any[]) => any[] }} [o] */
async function openNewYearSpareDelete(page, o = {}) {
    let week = 0;
    for (let w = 1; w <= CONFIG.MAIN_ROSTER_WEEKS && !week; w++) {
        if (NY_SPARE.every(d => getBaseShift(inventedCea(w), parseISODate(d)) === 'SPARE')) week = w;
    }
    expect(week, 'premise: some week of the main line is Spare over New Year 2026/27').toBeGreaterThan(0);
    const who = inventedCea(week);
    const allowance = /** @type {number} */ (entitlementFor(who, 2027, []));
    /** @type {string[]} */ const workdays = [];
    for (const d = new Date(2027, 1, 1, 12); workdays.length < allowance - 1; d.setDate(d.getDate() + 1)) {
        const base = getBaseShift(who, d);
        if (d.getDay() !== 0 && !isBankHoliday(d) && !isRestShift(base) && base !== 'SPARE') workdays.push(formatISO(d));
    }
    const leave = (/** @type {string} */ date) => ({ id: `ny-${date}`, memberName: who.name, date, type: 'annual_leave', value: 'AL', note: '',
        source: 'manual', replacedType: 'spare_shift' });
    const rows = [...NY_SPARE.map(leave), ...workdays.map(leave)];
    await serveInventedMember(page, who);
    await page.clock.setFixedTime(new Date('2026-12-10T09:00:00Z'));   // the list opens on 2026, where 28–31 December are
    await seedSession(page, 'G. Miller');
    await page.addInitScript(([docs, txDocs]) => {
        /** @type {any} */ (window).__E2E = Object.assign(/** @type {any} */ (window).__E2E || {}, { authUser: true, docs, ...(txDocs ? { txDocs } : {}) });
    }, [rows, o.server ? o.server(rows) : null]);
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    await page.locator('#fieldMember').selectOption(who.name);
    await page.locator('#alToggleHeader').click();
    await page.locator('#alBookedToggle').click();
    // By the row, not the control's name: an armed ✕ is named "Confirm delete …".
    const row = page.locator('#alBookedBody .al-period-row').filter({ hasText: 'Mon 28 – Thu 31 Dec' });
    await expect(row, 'premise: 28–31 December is one row of the 2026 list').toHaveCount(1);
    const btn = row.locator('.btn-period-delete');
    await clickInView(btn);
    await expect(btn).toHaveText('Delete?');
    await pastDoubleTap(page);
    await clickInView(btn);
    return { who, btn };
}
const deletedCount = (/** @type {import('@playwright/test').Page} */ page) => page.evaluate(() => (/** @type {any} */ (window).__E2E?.deletedPaths || []).length);

test('admin: a Recorded dates delete that leaves next year over its allowance asks first, and deletes on "Save anyway"', async ({ page }) => {
    const { who, btn } = await openNewYearSpareDelete(page);
    const bar = page.locator('#alConfirmBar');
    await expect(bar).toHaveClass(/visible/);
    await expect(page.locator('#alConfirmMsg')).toContainText('2027');
    expect(await deletedCount(page), 'nothing is deleted while the question is open').toBe(0);
    await expect(page.locator('#alConfirmSaveBtn'), 'the question has focus').toBeFocused();
    await expect(btn).toHaveText('✕');
    await page.locator('#alConfirmSaveBtn').click();
    await expect(page.locator('#alFeedback')).toContainText(`Deleted 4 days of Annual Leave for ${who.name}`);
    expect(await deletedCount(page), 'the four December days').toBe(4);
    await expect(bar).not.toHaveClass(/visible/);
});

test('admin: Cancel on a Recorded dates delete\'s question deletes nothing, and hands focus back to its ✕', async ({ page }) => {
    const { btn } = await openNewYearSpareDelete(page);
    await expect(page.locator('#alConfirmBar')).toHaveClass(/visible/);
    await page.locator('#alConfirmCancelBtn').click();
    expect(await deletedCount(page)).toBe(0);
    await expect(btn).toBeFocused();
    await expect(btn).toHaveText('✕');
});

test('admin: "Save anyway" on a Recorded dates delete still refuses a day a colleague has changed since', async ({ page }) => {
    // The server's 29 December is a worked rest day now: the answer deletes what was on screen at the tap, or nothing.
    await openNewYearSpareDelete(page, { server: rows => rows.map(r => r.date === '2026-12-29' ? { ...r, type: 'rdw', value: '09:00-17:00' } : r) });
    await expect(page.locator('#alConfirmBar')).toHaveClass(/visible/);
    await page.locator('#alConfirmSaveBtn').click();
    await expect(page.locator('#alFeedback')).toContainText(/Someone else has changed this/);
    expect(await deletedCount(page), 'something was deleted').toBe(0);
});

// THE FEEDBACK LINE HAS ONE FADE (whole-app check, Nov 2026; routed from admin-2, admin-2-7). A delete's
// "✓ Deleted" set its own untracked six-second timer, which then took down whatever the line said next —
// here the refusal of a second delete, gone three seconds after it appeared.
test('admin: a refused delete straight after a delete stays on screen past the first one\'s fade', async ({ page }) => {
    await page.clock.setFixedTime(LEAVE_LIST_DAY);
    const me = /** @type {any} */ (teamMembers.find(m => m.name === 'G. Miller'));
    const iso = (/** @type {Date} */ d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const works = (/** @type {Date} */ d) => d.getDay() !== 0 && /^\d\d:\d\d-/.test(getBaseShift(me, d));
    const firstWorked = (/** @type {Date} */ from) => { const d = new Date(from); while (!works(d)) d.setDate(d.getDate() + 1); return d; };
    const a = firstWorked(new Date(2026, 2, 2));
    const days = [iso(a), iso(firstWorked(new Date(a.getFullYear(), a.getMonth(), a.getDate() + 7)))];   // two periods
    await seedMemberSession(page, 'G. Miller');
    await page.addInitScript((ds) => {
        /** @type {any} */ (window).__E2E = Object.assign(/** @type {any} */ (window).__E2E || {}, {
            docs: ds.map((/** @type {string} */ date, /** @type {number} */ i) => ({ id: 'k' + i, memberName: 'G. Miller', date, type: 'annual_leave', value: 'AL', note: '' })),
        });
    }, days);
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    await page.locator('#fieldMember').selectOption('G. Miller');
    await page.locator('#alToggleHeader').click();
    await page.locator('#alBookedToggle').click();
    const dels = page.locator('#alBookedBody .btn-period-delete');
    await dels.first().click();
    await pastDoubleTap(page);
    await dels.first().click();
    const line = page.locator('#alFeedback');
    await expect(line).toContainText('Deleted 1 day of Annual Leave');
    // A colleague changes the other day; deleting it now is refused, on the same line.
    await page.evaluate((d) => { /** @type {any} */ (window).__E2E.txDocs = [{ id: 'k1', memberName: 'G. Miller', date: d, type: 'rdw', value: '09:00-17:00' }]; }, days[1]);
    await page.clock.fastForward(3_000);
    await dels.first().click();
    await pastDoubleTap(page);
    await dels.first().click();
    await expect(line).toContainText(/Someone else has changed this/);
    await page.clock.fastForward(4_000);   // past the first delete's six seconds
    await expect(line, 'the refusal is still there to read').toHaveClass(/\berror\b/);
    await expect(line).toBeVisible();
});

// A REFUSED PERIOD DELETE IS NOT BLAMED ON THE CONNECTION (whole-app check, Nov 2026; routed from admin-2,
// admin-2-10). Anything not named was "Delete failed — check your connection", a refusal by the rules included.
test('admin: a period delete the rules refuse says so, not "check your connection"', async ({ page }) => {
    await page.clock.setFixedTime(LEAVE_LIST_DAY);
    await seedMemberSession(page, 'G. Miller');
    await page.addInitScript(() => {
        /** @type {any} */ (window).__E2E = Object.assign(/** @type {any} */ (window).__E2E || {}, {
            docs: [{ id: 'a1', memberName: 'G. Miller', date: '2026-03-02', type: 'annual_leave', value: 'AL', note: '' }],
        });
    });
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    await page.locator('#fieldMember').selectOption('G. Miller');
    await page.locator('#alToggleHeader').click();
    await page.locator('#alBookedToggle').click();
    // The stub records each delete it is handed; recording this one throws the rules' refusal instead.
    await page.evaluate(() => { /** @type {any} */ (window).__E2E.deletedPaths = { push() {
        throw Object.assign(new Error('Missing or insufficient permissions'), { code: 'permission-denied' }); } }; });
    const btn = page.locator('#alBookedBody .btn-period-delete').first();
    await btn.click();
    await pastDoubleTap(page);
    await btn.click();
    await expect(page.locator('#alFeedback')).toContainText('you may have been signed out');
    await expect(page.locator('#alFeedback')).not.toContainText('check your connection');
});

test('admin: an armed Saved Changes delete says so in its accessible name, and says it only while armed', async ({ page }) => {
    // The recorded-dates ✕ already renames itself "Confirm delete …" while armed; this control kept
    // announcing "Delete G. Miller 2026-09-01" under a button reading "Delete?" (external review,
    // v23.16). A destructive two-step control has to communicate that its meaning changed — and
    // change back, on every exit. The exit a browser can SEE is the confirm lapsing: a successful
    // delete removes the row (unlike the recorded-dates control, this one does not refuse without
    // a Firebase user), and the failure exit is pinned in admin-saved-changes.test.mjs.
    await seedSession(page, 'G. Miller');
    await page.addInitScript(() => {
        /** @type {any} */ (window).__E2E = Object.assign(/** @type {any} */ (window).__E2E || {}, {
            docs: [{ id: 'o1', memberName: 'G. Miller', date: '2026-09-01', type: 'annual_leave', value: 'AL', note: '' }],
        });
    });
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    await page.locator('#fieldMember').selectOption('G. Miller');
    await page.locator('#overridesToggleHeader').click();
    const btn = page.locator('.override-card .btn-delete').first();
    await expect(btn).toHaveAttribute('aria-label', 'Delete G. Miller 1 September 2026');
    await btn.click();
    await expect(btn).toHaveText('Delete?');
    await expect(btn, 'armed: the name says so').toHaveAttribute('aria-label', 'Confirm delete G. Miller 1 September 2026');
    // Let the confirm lapse (5s) rather than pressing again: the name has to come back WITH the glyph.
    await expect(btn, 'idle again: the name comes back with the glyph').toHaveAttribute('aria-label', 'Delete G. Miller 1 September 2026', { timeout: 7000 });
    await expect(btn).toHaveText('✕');
    await expect(btn).not.toHaveClass(/confirming/);
});

// NEWEST FIRST ON LOAD, NOT ONLY AFTER A SAVE (whole-app check, Nov 2026; admin-2-3). The member read has no
// orderBy, so the list came in document-id order — a roster import's random id among the manual `m_<date>` ones.
test('admin: a member\'s Saved Changes are listed newest first as they load', async ({ page }) => {
    await seedSession(page, 'G. Miller');
    await page.addInitScript(() => {
        /** @type {any} */ (window).__E2E = Object.assign(/** @type {any} */ (window).__E2E || {}, {   // as Firestore answers: by id
            docs: [['m_2026-09-01_G.%20Miller', '2026-09-01'], ['Zx81', '2026-09-20'], ['m_2026-09-10_G.%20Miller', '2026-09-10'], ['aB3', '2026-09-03']]
                .map(([id, date]) => ({ id, memberName: 'G. Miller', date, type: 'shift', value: '09:00-17:00', note: '' })),
        });
    });
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    await page.locator('#fieldMember').selectOption('G. Miller');
    await page.locator('#overridesToggleHeader').click();
    await expect(page.locator('.override-card')).toHaveCount(4);
    expect(await page.locator('.override-card .btn-edit').evaluateAll(bs => bs.map(b => b.getAttribute('data-date'))))
        .toEqual(['2026-09-20', '2026-09-10', '2026-09-03', '2026-09-01']);
});

// ── A DELETE FROM THE KEYBOARD HANDS FOCUS ON (whole-app check, 10 Nov 2026) ─────────────────────
// Both lists re-render on a delete and destroy the ✕ that held focus, and a focused element that is
// removed hands focus to <body>: a keyboard user's next Tab began again at the burger. Focus now goes
// to the ✕ that took the deleted one's place, and when none is left, to the line that says what
// happened. One test per list, each through the real delete.
test('admin: a Recorded dates ✕ pressed from the keyboard hands focus on, never to the top of the page', async ({ page }) => {
    await page.clock.setFixedTime(LEAVE_LIST_DAY);
    const me = /** @type {any} */ (teamMembers.find(m => m.name === 'G. Miller'));
    const iso = (/** @type {Date} */ d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const works = (/** @type {Date} */ d) => d.getDay() !== 0 && /^\d\d:\d\d-/.test(getBaseShift(me, d));
    // Two single days a week apart, with working days between them, so they are two periods.
    const firstWorked = (/** @type {Date} */ from) => { const d = new Date(from); while (!works(d)) d.setDate(d.getDate() + 1); return d; };
    const a = firstWorked(new Date(2026, 2, 2));
    const days = [iso(a), iso(firstWorked(new Date(a.getFullYear(), a.getMonth(), a.getDate() + 7)))];
    await seedSession(page, 'G. Miller');
    await page.addInitScript((ds) => {
        /** @type {any} */ (window).__E2E = Object.assign(/** @type {any} */ (window).__E2E || {}, {
            authUser: true,
            docs: ds.map((/** @type {string} */ date, /** @type {number} */ i) => ({ id: 'k' + i, memberName: 'G. Miller', date, type: 'annual_leave', value: 'AL', note: '' })),
        });
    }, days);
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    await page.locator('#fieldMember').selectOption('G. Miller');
    await page.locator('#alToggleHeader').click();
    await page.locator('#alBookedToggle').click();
    const dels = page.locator('#alBookedBody .btn-period-delete');
    await expect(dels, 'premise: two periods, two ✕').toHaveCount(2);

    await dels.first().focus();
    await page.keyboard.press('Enter');
    await expect(dels.first()).toHaveText('Delete?');
    await pastDoubleTap(page);
    await page.keyboard.press('Enter');
    await expect(dels).toHaveCount(1);
    await expect(dels.first(), 'the ✕ that took its place').toBeFocused();

    await page.keyboard.press('Enter');
    await expect(dels.first()).toHaveText('Delete?');
    await pastDoubleTap(page);
    await page.keyboard.press('Enter');
    await expect(dels).toHaveCount(0);
    // No ✕ left, but the list stays — it still shows the year's Christmas leave — so focus goes to
    // the year chip it is showing. (A list that empties and hides hands it to #alFeedback instead:
    // admin-booked-periods.test.mjs, where no Christmas row keeps the box open.)
    await expect(page.locator('#alBookedBody .al-year-chip.is-active'), 'none left: the year the list is showing').toBeFocused();
});

test('admin: a Saved Changes ✕ pressed from the keyboard hands focus on, never to the top of the page', async ({ page }) => {
    await page.clock.setFixedTime(LEAVE_LIST_DAY);
    await seedSession(page, 'G. Miller');
    await page.addInitScript(() => {
        /** @type {any} */ (window).__E2E = Object.assign(/** @type {any} */ (window).__E2E || {}, {
            authUser: true,
            docs: [
                { id: 's1', memberName: 'G. Miller', date: '2026-09-01', type: 'annual_leave', value: 'AL', note: '' },
                { id: 's2', memberName: 'G. Miller', date: '2026-09-08', type: 'annual_leave', value: 'AL', note: '' },
            ],
        });
    });
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    await page.locator('#fieldMember').selectOption('G. Miller');
    await page.locator('#overridesToggleHeader').click();
    const dels = page.locator('#overrideTableBody .btn-delete');
    await expect(dels, 'premise: two rows, two ✕').toHaveCount(2);

    await dels.first().focus();
    await page.keyboard.press('Enter');
    await expect(dels.first()).toHaveText('Delete?');
    await pastDoubleTap(page);
    await page.keyboard.press('Enter');
    await expect(dels).toHaveCount(1);
    await expect(dels.first(), 'the ✕ that took its place').toBeFocused();

    await page.keyboard.press('Enter');
    await expect(dels.first()).toHaveText('Delete?');
    await pastDoubleTap(page);
    await page.keyboard.press('Enter');
    await expect(dels).toHaveCount(0);
    await expect(page.locator('#listFeedback'), 'none left: the line that says what happened').toBeFocused();
});

// …AND THE LINE IT LANDS ON WEARS THE APP'S RING (whole-app check, 10 Nov 2026). With no rule of their
// own, the three lines that take that focus drew the browser's default `outline: auto` instead of the
// app's --focus-outline (measured in Chromium) — the one focus indicator outside the design system.
for (const [line, list] of [['listFeedback', 'Saved Changes'], ['alFeedback', 'Recorded dates']]) {
    test(`admin: the ${list} line a keyboard delete hands focus to wears the app's focus ring`, async ({ page }) => {
        // 2025 for Recorded dates: no Christmas row yet, so the one delete empties and hides the list.
        await page.clock.setFixedTime(new Date(line === 'alFeedback' ? '2025-11-05T09:00:00Z' : '2026-11-03T09:00:00Z'));
        await seedSession(page, 'G. Miller');
        await page.addInitScript(() => {
            /** @type {any} */ (window).__E2E = Object.assign(/** @type {any} */ (window).__E2E || {}, {
                authUser: true, docs: [{ id: 'k1', memberName: 'G. Miller', date: '2026-03-02', type: 'annual_leave', value: 'AL', note: '' }],
            });
        });
        await page.goto('/admin.html');
        await page.waitForSelector('.day-row', { timeout: 10000 });
        await page.locator('#fieldMember').selectOption('G. Miller');
        if (line === 'alFeedback') { await page.locator('#alToggleHeader').click(); await page.locator('#alBookedToggle').click(); }
        else await page.locator('#overridesToggleHeader').click();
        const del = page.locator(line === 'alFeedback' ? '#alBookedBody .btn-period-delete' : '#overrideTableBody .btn-delete').first();
        await del.focus();
        await page.keyboard.press('Enter');
        await pastDoubleTap(page);
        await page.keyboard.press('Enter');
        await expect(page.locator(`#${line}`), 'premise: the delete handed focus to the line').toBeFocused();
        const ring = await page.evaluate((id) => {
            const read = (/** @type {Element} */ el) => { const s = getComputedStyle(el); return [s.outlineStyle, s.outlineWidth, s.outlineColor].join(' '); };
            const token = document.createElement('div');
            token.style.outline = 'var(--focus-outline)';
            document.body.append(token);
            const want = read(token);
            token.remove();
            return { got: read(/** @type {Element} */ (document.getElementById(id))), want };
        }, line);
        expect(ring.got).toBe(ring.want);
    });
}
