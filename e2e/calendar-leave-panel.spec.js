/**
 * calendar-leave-panel.spec.js — the Calendar (index.html): the leave panel — its balance and what may
 * be shown of it, its year, its links, and Christmas leave.
 *
 * Split by feature out of calendar.spec.js on 25 Nov 2026, test for test and unchanged; what more than
 * one calendar-*.spec.js file needs is in calendar-helpers.js. Every file keeps the old file's
 * `beforeEach`, so each test still starts signed in as a member. The Calendar's access gate is
 * calendar-access.spec.js.
 */
import { test, expect } from './fixtures.js';
import { teamMembers, getBaseShift } from '../roster-data.js';
import { seedMember, seedCalendarMember, seedMemberSession } from './helpers.js';

// ── Calendar access ─────────────────────────────────────────────────────────────────────────────
// The Calendar opens only for a signed-in member (since the staff PIN was retired, 23 Nov 2026; from
// v20.12 the PIN opened it too), so a spec that simply loads index.html gets the sign-in card and none
// of the roster. Every test in this file is about what the Calendar DOES once it is open, not about
// the gate, so each page starts signed in as a member with no calendar picked on this device
// (`seedCalendarMember`) — the member's own calendar. Until the PIN went it started on a PIN viewer,
// whose `getSession()` was null; the tests that existed only for that state (the first-run prompt,
// the station PC's Team View and bug report) went with it. The gate itself is calendar-access.spec.js.
test.beforeEach(async ({ page }) => { await seedCalendarMember(page); });

// ─── THE LEAVE PANEL'S LABELS LOSE THEIR TRACKING AT 320px (whole-app fix, 10 Nov 2026) ────────────
// The 320px rule that buys back the width of "ENTITLEMENT" sat ABOVE the label's own rule, so its
// tracking half lost on source order and had never applied. Measured against the 0.3px it has above.
test('calendar: at 320px the leave panel\'s labels drop their tracking', async ({ page }) => {
    await seedMember(page);
    await seedMemberSession(page);
    const tracking = async (/** @type {number} */ width) => {
        await page.setViewportSize({ width, height: 700 });
        await page.goto('/');
        await expect(page.locator('.calendar-day').first()).toBeVisible();
        await page.locator('#alBtn').click();
        await expect(page.locator('#alLightboxContent')).toBeVisible();
        return page.locator('.al-lb-lbl').first().evaluate(el => getComputedStyle(el).letterSpacing);
    };
    expect(await tracking(375), 'premise: the labels are tracked at a phone\'s usual width').toBe('0.3px');
    expect(['normal', '0px'], 'no tracking at 320px').toContain(await tracking(320));
});

// THE LEAVE PANEL IS THE SOLID NAVY SHEET (owner, 25 Nov 2026), as the notices and About are: its four figures read
// through the month's coloured cells while it was see-through. Read as COMPUTED style, because the change is one
// selector in shared.css and index.css's own rule, later in the cascade, can quietly put the glass back.
test('calendar: the leave panel is the opaque navy sheet, the day panel still glass', async ({ page }) => {
    await seedMember(page);
    await seedMemberSession(page);
    await page.goto('/');
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    const navy = await page.evaluate(() => {
        const probe = document.createElement('div');
        probe.style.backgroundColor = 'var(--primary-blue)';
        document.body.append(probe);
        const c = getComputedStyle(probe).backgroundColor; probe.remove(); return c;
    });
    await page.locator('#alBtn').click();
    await expect(page.locator('#alLightboxContent')).toBeVisible();
    await expect(page.locator('#alLightboxContent')).toHaveCSS('background-color', navy);
    await page.locator('#alLightboxClose').click();
    await page.locator('.calendar-day:not(.other-month)').nth(10).click();
    await expect(page.locator('#dayDetailContent')).toBeVisible();
    expect(await page.locator('#dayDetailContent').evaluate(el => getComputedStyle(el).backgroundColor),
        'the day panel looks at the day behind it, so it stays see-through').not.toBe(navy);
});

// ── CHRISTMAS LEAVE (v25.37, owner 5 Nov 2026) ──────────────────────────────────────────────────
//
// The rules are unit-tested in christmas-leave.test.mjs and the grid's wiring in
// calendar-renderer.test.mjs. This is the half only a browser sees: the panel SAYS it, and the leave
// panel lists the day and counts the earned one — in 2027, the NEXT year's allowance (owner, 15 Nov
// 2026: the roster clerk says the day is valid for a year). The signed-in member's pattern has a late
// turn on both days in 2026; the fixture records that Boxing Day as worked, and nothing else.
// …AND A DAY TAKEN LATE THAT DECEMBER IS SPENT THERE (owner, 25 Nov 2026). With 2026's allowance used up, leave after
// Boxing Day takes the day in lieu in 2026, so 2027 does not hold it too. The panel for 2027 can only know that from
// 2026's whole year of leave, so its read starts at the first Christmas the rules apply to, not last Boxing Day.
test('christmas: leave after a worked Boxing Day, past the year\'s allowance, spends the day in lieu that December', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-12-10T09:00:00Z'));
    await seedMemberSession(page, 'G. Miller');
    const me = /** @type {any} */ (teamMembers.find(t => t.name === 'G. Miller'));
    const iso = (/** @type {Date} */ d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const timed = (/** @type {Date} */ d) => d.getDay() !== 0 && /^\d\d:\d\d-/.test(String(getBaseShift(me, d)));
    /** @type {string[]} */ const leave = [];
    for (let d = new Date(2026, 0, 5); leave.length < 32; d.setDate(d.getDate() + 1)) if (timed(d)) leave.push(iso(d));
    const late = [28, 29, 30, 31].map(day => new Date(2026, 11, day)).find(timed);
    expect(late, 'premise: a working day between 28 and 31 December 2026 on G. Miller\'s line').toBeTruthy();
    leave.push(iso(/** @type {Date} */ (late)));
    await page.addInitScript((days) => {
        const w = /** @type {any} */ (window); w.__E2E = w.__E2E || {};
        w.__E2E.docs = [
            ...days.map((date, i) => ({ id: 'al' + i, memberName: 'G. Miller', date, type: 'annual_leave', value: 'AL', note: '', source: 'manual' })),
            { id: 'bx', memberName: 'G. Miller', date: '2026-12-26', type: 'rdw', value: '13:30-21:00', note: '', source: 'manual' },
        ];
    }, leave);
    await page.goto('/');
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    await page.locator('#alBtn').click();
    await expect(page.locator('#alLbYear')).toHaveText('2026');
    await expect(page.locator('#alLbEntitlement')).toHaveText('33');
    await expect(page.locator('#alLbRemaining')).toHaveText('0');
    await expect(page.locator('#alLbBreakdown'))
        .toHaveText('Entitlement 33: includes 1 day in lieu for working Boxing Day 2026, taken on leave after it that December');
    await page.locator('#alLbNextYear').click();
    await expect(page.locator('#alLbYear')).toHaveText('2027');
    await expect(page.locator('#alLbEntitlement'), 'spent in December 2026, so not in 2027 as well').toHaveText('32');
    await expect(page.locator('#alLbBreakdown')).toBeHidden();
    // The read the 2027 panel made reached back to the first Christmas, which is what let it see 2026's leave.
    const asked = await page.evaluate(() => /** @type {any} */ (window).__E2E.whereCalls.filter((/** @type {any} */ w) => w[0] === 'date' && w[1] === '>=').map((/** @type {any} */ w) => w[2]));
    expect(asked.at(-1), 'the 2027 panel read from 26 December 2025, not from Boxing Day 2026').toBe('2025-12-26');
});

test('christmas: a day due at work is leave never counted, and a worked Boxing Day adds a day to the next year', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-12-10T09:00:00Z'));
    await seedMemberSession(page, 'G. Miller');
    await page.addInitScript(() => {
        const w = /** @type {any} */ (window); w.__E2E = w.__E2E || {};
        w.__E2E.docs = [{ id: 'bx', memberName: 'G. Miller', date: '2026-12-26', type: 'rdw',
            value: '13:30-21:00', note: '', source: 'manual' }];
    });
    await page.goto('/');
    await expect(page.locator('.calendar-day').first()).toBeVisible();

    const cell = (/** @type {string} */ day) => page.locator(`.calendar-day:not(.other-month)[data-detail-day="${day}"]`);
    const line = page.locator('#dayDetailChristmas');
    await expect(cell('Friday 25 December 2026')).toHaveAttribute('data-detail-shift-value', 'AL');
    await cell('Friday 25 December 2026').click();
    await expect(line).toBeVisible();   // the text alone is no proof: a hidden line still holds it
    await expect(line).toHaveText('Christmas Day: due at work, so this is annual leave. It does not come off the allowance.');
    // The pair names the turn the member was ROSTERED — never "Rest day", which `getBaseShift` makes the day.
    await expect(page.locator('#dayDetailChangeSaid')).toHaveText(/^Base roster Late shift 14:00-22:30, changed to /);
    await page.locator('#dayDetailClose').click();

    await expect(cell('Saturday 26 December 2026')).toHaveAttribute('data-detail-shift-value', 'RDW');
    await cell('Saturday 26 December 2026').click();
    await expect(line).toBeVisible();
    await expect(line).toHaveText('Worked Boxing Day when due at work: one day of annual leave in lieu, to take from 27 December. If leave later this December runs past the 2026 allowance, it covers that; otherwise it is added to the 2027 allowance.');
    await page.locator('#dayDetailClose').click();
    // An ordinary day says nothing about Christmas — absent means HIDDEN, not an empty line.
    await cell('Thursday 24 December 2026').click();
    await expect(line).toBeHidden();
    await page.locator('#dayDetailClose').click();

    // The leave panel lists Christmas Day as leave not counted. 2026's allowance is the contract
    // figure; 2027's is one higher, with its reason beside it naming the Boxing Day, or 33 would read
    // as a mistake beside a colleague's 32.
    await page.locator('#alBtn').click();
    await expect(page.locator('#alLbYear')).toHaveText('2026');
    await expect(page.locator('#alLbChristmas')).toHaveText('Christmas Day: annual leave that does not come off the allowance');
    await expect(page.locator('#alLbTaken')).toHaveText('0');
    await expect(page.locator('#alLbEntitlement')).toHaveText('32');
    await expect(page.locator('#alLbBreakdown')).toBeHidden();
    await page.locator('#alLbNextYear').click();
    await expect(page.locator('#alLbYear')).toHaveText('2027');
    await expect(page.locator('#alLbEntitlement')).toHaveText('33');
    await expect(page.locator('#alLbRemaining')).toHaveText('33');
    await expect(page.locator('#alLbBreakdown')).toBeVisible();
    await expect(page.locator('#alLbBreakdown')).toHaveText('Entitlement 33: includes 1 day in lieu for working Boxing Day 2026');
    // A FULL-WIDTH LINE UNDER THE FIGURES (lightbox review, 22 Nov 2026), not a caption in the quarter-width
    // Entitlement cell, where a long note stretched all four figures to its height.
    const fit = await page.evaluate(() => {
        const note = /** @type {HTMLElement} */ (document.getElementById('alLbBreakdown')).getBoundingClientRect();
        const stats = /** @type {HTMLElement} */ (document.querySelector('.al-lb-stats')).getBoundingClientRect();
        return { below: note.top >= stats.bottom, share: note.width / stats.width };
    });
    expect(fit.below, 'the note sits under the four figures').toBe(true);
    expect(fit.share, 'and has the panel\'s width, not a quarter of it').toBeGreaterThan(0.6);
    await page.locator('#alLightboxClose').click();

    // Team Week View says the same about the same days — it asks the same resolver. Two weeks on
    // from today's: Sunday 20 to Saturday 26 December, so Friday is the sixth cell of his row.
    await page.locator('#teamViewBtn').click();
    await page.locator('#tvNextWeek').click();
    await page.locator('#tvNextWeek').click();
    await expect(page.locator('#tvWeekJump')).toContainText('20');
    const row = page.locator('tr', { has: page.locator('th.tv-name-col', { hasText: 'G. Miller' }) });
    await expect(row.locator('td.tv-cell').nth(5)).toHaveAttribute('aria-label', 'Annual leave (Christmas, not counted)');
    await expect(row.locator('td.tv-cell').nth(6)).not.toHaveAttribute('aria-label', /Annual leave/);
});

// ── A CACHE-SERVED LEAVE BALANCE IS REFUSED (Oct 2026 review) ───────────────────────────────────
// Offline, the year query is answered from whatever records the device happens to hold, and counting
// those overstates the leave left. The panel must say it could not load rather than show a figure.
test('calendar: the leave panel refuses a balance served from the offline cache', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-02T09:00:00Z'));
    await seedMemberSession(page, 'G. Miller');
    await page.addInitScript(() => {
        const w = /** @type {any} */ (window); w.__E2E = w.__E2E || {};
        w.__E2E.docs = [{ id: 'a1', memberName: 'G. Miller', date: '2026-03-04', type: 'annual_leave', value: 'AL', note: '' }];
    });
    await page.goto('/');
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    await page.evaluate(() => { /** @type {any} */ (window).__E2E.docsFromCache = true; });
    await page.locator('#alBtn').click();
    await expect(page.locator('#alLbError')).toBeVisible();
    await expect(page.locator('#alLbTaken')).toHaveText('—');
});

// …AND A BALANCE THIS DEVICE SAVED EARLIER IS LABELLED AS ONE until a read confirms it (10 Nov 2026,
// cal-ui-2). The saved copy has no age limit: the member who reads "6 left" from a copy saved before
// three more days were recorded must be told it was not checked — the month grid's words for the same
// state (CALENDAR_DATA.md 18) — rather than shown it as current, and the figures stay.
/** Seed a saved 2026 balance for whoever the seeded session names, that no read would produce: 20
 *  taken, 6 booked, of 32. It is kept in the member's own stored roster (calendar-snapshot.js, 16 Nov
 *  2026), the copy every sign-out deletes — a balance with no month beside it is still a copy. */
const seedSavedBalance = (/** @type {import('@playwright/test').Page} */ page) => page.addInitScript(() => {
    const member = JSON.parse(localStorage.getItem('myb_admin_session') ?? '{}').name;
    localStorage.setItem('myb_cal_snapshot', JSON.stringify({ v: 1, member, months: {}, leave: { 2026: { savedAt: Date.now(),
        stats: { taken: 20, booked: 6, entitlement: 32, breakdown: null, carry: null, christmas: null } } } }));
});

test('calendar: the leave panel labels a saved balance it could not check, and keeps it', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-02T09:00:00Z'));
    await seedMemberSession(page, 'G. Miller');
    await seedSavedBalance(page);
    await page.goto('/');
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    await page.evaluate(() => { /** @type {any} */ (window).__E2E.docsFromCache = true; });
    await page.locator('#alBtn').click();
    await expect(page.locator('#alLbError')).toHaveText('Saved copy — couldn’t check for changes');
    await expect(page.locator('#alLbError')).toBeVisible();
    await expect(page.locator('#alLbTaken'), 'the saved figures stay').toHaveText('20');
    await expect(page.locator('#alLbRemaining')).toHaveText('6');
});

test('calendar: the leave panel says a saved balance is being checked, and drops that once it is', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-02T09:00:00Z'));
    await seedMemberSession(page, 'G. Miller');
    await seedSavedBalance(page);
    await page.goto('/');
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    await page.evaluate(() => { /** @type {any} */ (window).__E2E.docsHeld = true; });
    await page.locator('#alBtn').click();
    await expect(page.locator('#alLbTaken')).toHaveText('20');
    await expect(page.locator('#alLbError')).toHaveText('Saved copy — checking for changes…');
    await page.evaluate(() => { /** @type {any} */ (window).__E2E.docsHeld = false; });
    await expect(page.locator('#alLbTaken'), 'the server\'s answer replaces the copy').toHaveText('0');
    await expect(page.locator('#alLbError')).toBeHidden();
});

// …AND A BALANCE IS THE READER'S OWN, AND GOES WITH THEM (16 Nov 2026). The panel used to keep one key per
// member and year, `myb_al_stats_<name>|<year>`, and nothing deleted one: a shared phone kept every balance
// anybody had opened on it. The balance now rides in the member's own stored copy (calendar-snapshot.js), so
// the old keys are swept on load, and a balance is saved only into the signed-in member's copy.
test('calendar: the leave panel keeps no balance outside the member\'s own copy, and sweeps the old keys', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-02T09:00:00Z'));
    await seedMemberSession(page);
    await page.addInitScript(() => {
        localStorage.setItem('myb_al_stats_A. Colleague|2026', JSON.stringify({ taken: 1, booked: 1, entitlement: 30 }));
    });
    await page.goto('/');
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    await page.locator('#alBtn').click();
    await expect(page.locator('#alLbTaken'), 'premise: the read settled').toHaveText('0');
    const keys = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('myb_al_stats_')));
    expect(keys, 'a retired per-member balance key survived the load').toEqual([]);
    const copy = await page.evaluate(() => JSON.parse(localStorage.getItem('myb_cal_snapshot') ?? 'null'));
    const session = await page.evaluate(() => JSON.parse(localStorage.getItem('myb_admin_session') ?? '{}').name);
    expect(copy?.member, 'the balance is saved into the signed-in member\'s own copy').toBe(session);
    expect(Object.keys(copy?.leave ?? {})).toEqual(['2026']);
});

// ── THE LEAVE PANEL'S YEAR AND ITS SECOND ROUTE (v24.46, owner) ─────────────────────────────────
// "As we are nearing the end of the year I would like to be able to tap right and see 2027's", and a
// second button to the recorded-leave list. The figures are asserted, not just the label: a year
// control that relabels the panel while still counting the old year is the failure worth catching.
test('calendar: the leave panel steps to next year and links to that year\'s recorded leave', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-02T09:00:00Z'));
    await seedMemberSession(page, 'G. Miller');
    await page.addInitScript(() => {
        const w = /** @type {any} */ (window); w.__E2E = w.__E2E || {};
        w.__E2E.docs = [
            { id: 'a1', memberName: 'G. Miller', date: '2026-03-04', type: 'annual_leave', value: 'AL', note: '' },
            // A whole working week, so at least one day costs entitlement whatever the roster
            // makes of any single date. Counted below as "not zero", which a relabel cannot fake.
            ...['2027-03-01', '2027-03-02', '2027-03-03', '2027-03-04', '2027-03-05'].map((date, i) =>
                ({ id: 'b' + i, memberName: 'G. Miller', date, type: 'annual_leave', value: 'AL', note: '' })),
        ];
    });
    await page.goto('/');
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    await page.locator('#alBtn').click();

    const year = page.locator('#alLbYear');
    const view = page.locator('#alLbViewLink');
    await expect(year).toHaveText('2026');
    await expect(view).toBeVisible();
    await expect(view).toHaveText('Leave dates');
    await expect(view).toHaveAttribute('href', 'admin.html?alYear=2026#alBookedBox');

    await page.locator('#alLbNextYear').click();
    await expect(year).toHaveText('2027');
    await expect(page.locator('#alLbTaken'), 'nothing in 2027 has been taken yet').toHaveText('0');
    await expect(page.locator('#alLbBooked'), 'the figures are 2027\'s, not a relabelled 2026').not.toHaveText(/^(0|…)$/);
    await expect(view).toHaveAttribute('href', 'admin.html?alYear=2027#alBookedBox');

    await page.locator('#alLbPrevYear').click();
    await expect(year).toHaveText('2026');
    await expect(page.locator('#alLbBooked')).toHaveText('0');
    await expect(page.locator('#alLbTaken')).toHaveText('1');

    // Reopening starts from the year the calendar shows again, not wherever the panel was left.
    await page.locator('#alLbNextYear').click();
    await expect(year).toHaveText('2027');
    await page.locator('#alLightboxClose').click();
    await expect(page.locator('#alLightbox')).not.toHaveClass(/open/);
    await page.locator('#alBtn').click();
    await expect(year).toHaveText('2026');
});

// ── THE LEAVE PANEL'S LINKS SHOW WHERE THE KEYBOARD IS (whole-app review, 10 Nov 2026) ──────────
// "Record leave" and "Leave dates" had no focus rule, so Tab gave them the app's NAVY fallback ring,
// drawn 2px out on the panel's navy glass — 1.0–1.8:1, no indicator at all — while every other control
// on the panel wears gold. calendar-controls-parity.test.mjs names the rule; this proves it wins.
test('calendar: the leave panel\'s two links take the gold focus ring on its navy glass', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.clock.setFixedTime(new Date('2026-10-02T09:00:00Z'));
    await seedMemberSession(page, 'G. Miller');
    await page.goto('/');
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    await page.locator('#alBtn').click();
    await expect(page.locator('#alLbViewLink'), 'premise: the member\'s own panel shows both links').toBeVisible();
    const ringOf = (/** @type {string} */ token) => page.evaluate((t) => {
        const probe = document.body.appendChild(document.createElement('div'));
        probe.style.outline = `var(${t})`;
        const c = getComputedStyle(probe).outlineColor;
        probe.remove();
        return c;
    }, token);
    const gold = await ringOf('--focus-outline-gold');
    expect(gold, 'premise: the gold and navy rings are two colours').not.toBe(await ringOf('--focus-outline'));
    for (const name of ['Record leave', 'Leave dates']) {
        let ring = null;
        for (let i = 0; i < 12 && !ring; i++) {
            await page.keyboard.press('Tab');
            ring = await page.evaluate((n) => {
                const el = document.activeElement;
                if (!el?.matches('.al-lb-link') || el.textContent !== n) return null;
                const cs = getComputedStyle(el);
                return { style: cs.outlineStyle, width: cs.outlineWidth, colour: cs.outlineColor };
            }, name);
        }
        expect(ring, `"${name}"`).toEqual({ style: 'solid', width: '2px', colour: gold });
    }
});

// ── WHOSE LEAVE IT IS (v25.50, owner, 7 Nov 2026) ──────────────────────────────────────────────
// "When I choose a name in calendar I can see their individual AL amounts, which is fine. But the AL
// calendar screen doesn't actually tell me whose AL I'm looking at." The panel now names the member on
// every open, from the member its figures are counted for. The failures worth catching are naming
// nobody, naming the SIGNED-IN member on a colleague's calendar, and naming whoever was chosen when the
// page loaded after the picker has moved — a name read once at init, which no single open can see.
test('calendar: the leave panel names whose leave it is, and follows the member picker', async ({ page }) => {
    // The colleague is chosen by SHAPE, not written down: this test seeds leave and reads a leave
    // figure, and the Pages mirror serves this file (payroll-anonymity.test.mjs).
    const colleague = /** @type {string} */ (teamMembers.find(m => m.role === 'CEA' && !m.hidden && !m.managerOnly
        && !m.startDate && m.name !== 'G. Miller')?.name);
    expect(colleague, 'premise: a colleague on the member picker').toBeTruthy();
    await page.clock.setFixedTime(new Date('2026-10-02T09:00:00Z'));
    await seedMemberSession(page, 'G. Miller');
    await page.addInitScript((name) => {
        const w = /** @type {any} */ (window); w.__E2E = w.__E2E || {};
        // A whole working week, so some of it costs leave whatever the colleague's pattern makes of any
        // single date (a rest day costs nothing, and the figure would read 0 for the wrong reason).
        w.__E2E.docs = ['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06'].map((date, i) =>
            ({ id: 's' + i, memberName: name, date, type: 'annual_leave', value: 'AL', note: '' }));
    }, colleague);
    await page.goto('/');
    await expect(page.locator('.calendar-day').first()).toBeVisible();

    const who = page.locator('#alLbWho');
    const dialog = page.locator('#alLightbox');
    await page.locator('#alBtn').click();
    await expect(who).toHaveText('G. Miller');
    // ...and the dialog's own name says it, so a screen reader hears whose balance it is on arrival.
    await expect(dialog).toHaveAttribute('aria-label', 'Annual Leave balance, G. Miller');
    await expect(page.locator('#alLbTaken'), 'the signed-in member has no leave in this fixture').toHaveText('0');
    await page.locator('#alLightboxClose').click();
    await expect(dialog).not.toHaveClass(/open/);

    // A colleague chosen in the picker, with no reload — the case the owner reported.
    await page.evaluate((name) => {
        const sel = /** @type {HTMLSelectElement} */ (document.getElementById('teamMemberSelect'));
        const opt = [...sel.options].find(o => o.textContent?.trim() === name);
        if (!opt) throw new Error(`${name} is not in the member picker`);
        sel.value = opt.value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
    }, colleague);
    await page.locator('#alBtn').click();
    await expect(who).toHaveText(colleague);
    await expect(dialog).toHaveAttribute('aria-label', `Annual Leave balance, ${colleague}`);
    // The name and the figures belong to the same person: the colleague's March leave, not the
    // signed-in member's none.
    await expect(page.locator('#alLbTaken')).not.toHaveText(/^(0|…|—)$/);
});
