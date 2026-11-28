/**
 * calendar-team-view.spec.js — the Calendar (index.html): Team Week View — the week it opens on, the
 * week jump, its table, its date row and its swipe hint.
 *
 * Split by feature out of calendar.spec.js on 25 Nov 2026, test for test and unchanged; what more than
 * one calendar-*.spec.js file needs is in calendar-helpers.js. Every file keeps the old file's
 * `beforeEach`, so each test still starts signed in as a member. The Calendar's access gate is
 * calendar-access.spec.js.
 */
import { test, expect } from './fixtures.js';
import { teamMembers, getBaseShift, SHIFT_TIME_REGEX } from '../roster-data.js';
import { seedMember, seedCalendarMember, seedMemberSession, isTouchProject } from './helpers.js';

// ── Calendar access ─────────────────────────────────────────────────────────────────────────────
// The Calendar opens only for a signed-in member (since the staff PIN was retired, 23 Nov 2026; from
// v20.12 the PIN opened it too), so a spec that simply loads index.html gets the sign-in card and none
// of the roster. Every test in this file is about what the Calendar DOES once it is open, not about
// the gate, so each page starts signed in as a member with no calendar picked on this device
// (`seedCalendarMember`) — the member's own calendar. Until the PIN went it started on a PIN viewer,
// whose `getSession()` was null; the tests that existed only for that state (the first-run prompt,
// the station PC's Team View and bug report) went with it. The gate itself is calendar-access.spec.js.
test.beforeEach(async ({ page }) => { await seedCalendarMember(page); });

// THE ROW TEAM VIEW MARKS AS THE READER'S OWN IS THE MEMBER SIGNED IN (17 Nov 2026) — through the page's
// own wiring (`ownName`), which the unit test cannot reach. It was the picker's member: a colleague's
// row on a colleague's calendar. Two current CEAs are
// taken from the roster by position, so no name is written here.
test('team view: the row marked as the reader\'s own is the member signed in, never the picker\'s', async ({ page }) => {
    const [me, colleague] = teamMembers.filter(m => !m.hidden && m.role === 'CEA');
    await seedMemberSession(page, me.name);
    await page.addInitScript((n) => localStorage.setItem('myb_roster_selected_member', n), colleague.name);
    await page.goto('/');
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    await page.locator('#teamViewBtn').click();
    const mine = page.locator('tr.tv-my-row th.tv-name-col');
    await expect(mine).toHaveCount(1);
    await expect(mine, 'the colleague the picker shows was marked as the reader').toHaveText(me.name);
});

// …AND TEAM VIEW'S WEEK FOLLOWS THE SAME RULE AS THE MONTH (16 Nov 2026). It kept the week it was on, so
// a phone resumed on Sunday morning showed last week with no today in it, while a reload opened on this
// week. A grid on the old today's week moves with the date; a browsed week stays, until the member has
// been away for longer than half an hour (calendar-state.js, BROWSED_MONTH_KEPT_MS) — then this week.
test('calendar: Team View follows the date to the new week, and returns to this week after a long absence', async ({ page }) => {
    await page.clock.install({ time: new Date(2026, 10, 14, 23, 59, 0) });   // Saturday night
    await seedMember(page);
    await page.goto('/');
    await page.locator('#teamViewBtn').click();
    const week = page.locator('#tvWeekJump');
    await expect(week).toHaveText('8–14 Nov 2026');
    await page.clock.runFor('02:00');   // past local midnight: Sunday the 15th starts a new week
    await expect(week, 'the date turned and Team View stayed on last week').toHaveText('15–21 Nov 2026');
    await expect(page.locator('.tv-week-status--now')).toHaveText('This week');

    const visibility = (/** @type {'hidden'|'visible'} */ state) => page.evaluate((v) => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v });
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => v === 'hidden' });
        document.dispatchEvent(new Event('visibilitychange'));
    }, state);
    await page.locator('#tvNextWeek').click();
    await page.locator('#tvNextWeek').click();
    await expect(week).toHaveText('29 Nov–5 Dec 2026');
    await visibility('hidden');
    await page.clock.fastForward('10:00');
    await visibility('visible');
    await expect(week, 'ten minutes away took the member off the week they chose').toHaveText('29 Nov–5 Dec 2026');
    await visibility('hidden');
    await page.clock.fastForward('31:00');
    await visibility('visible');
    await expect(week, 'back after half an hour, still on a browsed week').toHaveText('15–21 Nov 2026');
});

// The page's arrow/t/p shortcuts listen on `document`, so they heard keys another control had
// already handled (a grade tab's arrows changed the WEEK too) and browser chords (Alt+→ changed the
// month on top of "forward"; Ctrl+P printed twice).
test('calendar: a grade tab\'s arrows, and modified keys, do not reach the page shortcuts', async ({ page }) => {
    await seedMember(page);
    await page.goto('/');
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    const month = page.locator('.month-year');
    const before = await month.textContent();
    await page.locator('body').focus();
    await page.keyboard.press('Alt+ArrowRight');
    await page.keyboard.press('Control+ArrowRight');
    await expect(month).toHaveText(/** @type {string} */ (before));
    await page.locator('#teamViewBtn').click();
    const week = page.locator('.team-week-text').first();
    await expect(week).toBeVisible();
    const weekBefore = await week.textContent();
    await page.locator('.grade-tab').first().focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.grade-tab').nth(1)).toBeFocused();
    await expect(week).toHaveText(/** @type {string} */ (weekBefore));
});

// v25.43 made the team week's sideways-scrolling table a tab stop on a narrow screen, so that a
// keyboard can reach the days off the edge — and the page's own → handler then turned the key into
// next week, re-rendering the grid and moving focus to the Next button (7 Nov 2026 review). On the
// focused table the arrows are the table's: it scrolls, and the week stays.
test('calendar: → on the focused team week table scrolls it, and the week stays', async ({ page }) => {
    await seedMember(page);
    await seedMemberSession(page);
    await page.setViewportSize({ width: 375, height: 820 });
    await page.goto('/');
    await page.waitForSelector('.control-group--actions', { state: 'attached' });
    await page.locator('#teamViewBtn').click();
    const panel = page.locator('#gradeTabPanel');
    const week = page.locator('.team-week-text').first();
    await expect(week).toBeVisible();
    const weekBefore = await week.textContent();
    expect(await panel.evaluate(el => el.scrollWidth - el.clientWidth),
        'the table must be wider than the screen, or this proves nothing').toBeGreaterThan(0);
    await panel.focus();
    await page.keyboard.press('ArrowRight');
    await expect(week).toHaveText(/** @type {string} */ (weekBefore));
    await expect(panel).toBeFocused();
    await expect.poll(() => panel.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
});

// …and from TEAM VIEW, where the name picker is not on screen (index.css hides it there), the leave panel
// says where a name is chosen: back in the month view, by its button's own words (18 Nov 2026).
test('calendar: Team View opens on the grade of the name picked, and a tab the reader chooses stays chosen', async ({ page }) => {
    // (Until the staff PIN was retired this began on a first run, nobody chosen, where Team View opened
    // on the first grade. A signed-in member always has a calendar on screen, so that state is gone.)
    const ces = teamMembers.find(m => !m.hidden && m.role === 'CES');
    expect(ces, 'premise: the roster has a CES').toBeTruthy();
    await page.goto('/');
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    await page.locator('#teamMemberSelect').selectOption({ label: ces.name });
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    await page.locator('#teamViewBtn').click();
    await expect(page.locator('#gradeTab-CES')).toHaveAttribute('aria-selected', 'true');
    // …and a tab the reader CHOOSES stays chosen when the view is opened again.
    await page.locator('#gradeTab-Dispatcher').click();
    await page.locator('#teamViewBtn').click();
    await page.locator('#teamViewBtn').click();
    await expect(page.locator('#gradeTab-Dispatcher')).toHaveAttribute('aria-selected', 'true');
});

// ─── THE TEAM VIEW'S WEEK LABEL MUST NOT SIT ON ITS ARROWS ───────────────────────────────────────
// Reported from a 412px phone: the full-month label ("30 August – 5 September 2026") measured 245px
// against a centre column of 167–237px, so it wrapped and — because the centre is `flex: 1` — its
// painted box ran flush against both arrows at ZERO px. On screen "2026" sat against "← Prev".
// The label is now the short form the Admin week grid already uses, and the row carries a gap, so
// the worst case is a tidy two lines rather than a collision.
for (const [width, fontPx] of [[320, 14], [360, 14], [390, 14], [412, 14], [412, 20]]) {
    test(`calendar: the team week label clears its arrows at ${width}px / ${fontPx}px text`, async ({ page }) => {
        await seedMember(page);
        await seedMemberSession(page);
        await page.setViewportSize({ width, height: 820 });
        await page.goto('/');
        await page.waitForSelector('.control-group--actions', { state: 'attached' });
        if (fontPx !== 14) {
            await page.addStyleTag({ content:
                `.controls select, .controls button, .team-week-text, .tv-week-nav { font-size: ${fontPx}px !important; }` });
        }
        await page.locator('#teamViewBtn').click();
        await page.waitForSelector('.team-week-text');
        await page.waitForTimeout(400);

        const geo = await page.evaluate(() => {
            const b = (sel) => { const r = document.querySelector(sel).getBoundingClientRect();
                return { left: r.left, right: r.right }; };
            const label = b('.team-week-text');
            return {
                gapLeft:  label.left - b('#tvPrevWeek').right,
                gapRight: b('#tvNextWeek').left - label.right,
                text: document.querySelector('.team-week-text').textContent.trim(),
            };
        });

        expect(geo.gapLeft, `the week label touches ← Prev (${geo.gapLeft}px)`).toBeGreaterThanOrEqual(4);
        expect(geo.gapRight, `the week label touches Next → (${geo.gapRight}px)`).toBeGreaterThanOrEqual(4);
        // The SHORT form is what keeps it on one line at the widths staff actually use. Asserted on
        // the rendered text so a revert to full month names fails here rather than on a screenshot.
        expect(geo.text, 'the week label went back to full month names').not.toMatch(/January|February|August|September|November|December/);
    });
}

// ─── ON A WIDE SCREEN THE TEAM VIEW BAR IS A CLUSTER, NOT A FULL-WIDTH ROW (v22.86) ─────────────
// At 1280px the two arrows sat at the far edges of a 1040px card, 400px from the label they move,
// while the month view directly above keeps Prev · name · Next as one compact centred group. Both
// rows are capped to the same width, so the ? stays in line with the arrow beneath it.
// Pinned because the first cut of the cap sat in a 900–1023px tablet block and applied on no
// desktop at all — a static rule that reads correctly and reaches nothing.
for (const width of [768, 1024, 1280, 1440]) {
    test(`calendar: the team view bar is one centred cluster at ${width}px, both rows the same width`, async ({ page }) => {
        await seedMember(page);
        await seedMemberSession(page);
        await page.setViewportSize({ width, height: 900 });
        await page.goto('/');
        await page.waitForSelector('.calendar-day');
        await page.locator('#teamViewBtn').click();
        await page.waitForSelector('.team-week-text');
        await page.locator('#tvNextWeek').click();   // browsing away, the fuller state
        await page.waitForTimeout(300);
        const geo = await page.evaluate(() => {
            const r = (s) => document.querySelector(s).getBoundingClientRect();
            const row = r('.team-week-row'), tabs = r('.grade-tabs-row'), card = r('.team-view-container');
            return { rowW: Math.round(row.width), tabsW: Math.round(tabs.width), cardW: Math.round(card.width),
                     centred: Math.abs((row.left + row.right) / 2 - (card.left + card.right) / 2) < 2,
                     helpRight: Math.round(r('#teamHelpBtn').right), nextRight: Math.round(r('#tvNextWeek').right) };
        });
        expect(geo.rowW, 'the week row is capped').toBeLessThanOrEqual(640);
        expect(geo.rowW, 'the cap is narrower than the card, or it is not a cluster').toBeLessThan(geo.cardW);
        expect(geo.tabsW, 'both rows take the same cap').toBe(geo.rowW);
        expect(geo.centred, 'the cluster is centred in the card').toBe(true);
        expect(Math.abs(geo.helpRight - geo.nextRight), 'the ? lines up over Next →').toBeLessThanOrEqual(2);
    });
}

// The abbreviation above is a WIDTH decision. The screen-reader announcement has no width, so it
// keeps the full month — a spoken "Jul" would be a regression bought for a column it does not sit
// in. Asserted on the live region's text, which nothing visual can see.
test('calendar: the team week is ANNOUNCED with the full month name, not the on-screen short form', async ({ page }) => {
    await seedMember(page);
    await seedMemberSession(page);
    await page.setViewportSize({ width: 390, height: 820 });
    await page.goto('/');
    await page.waitForSelector('.control-group--actions', { state: 'attached' });
    await page.locator('#teamViewBtn').click();
    await page.waitForSelector('.team-week-text');
    await page.locator('#tvNextWeek').click();
    await expect.poll(() => page.locator('#ariaAnnouncer').textContent()).toMatch(/^Week of \d/);
    const spoken = await page.locator('#ariaAnnouncer').textContent();
    expect(spoken, `announced "${spoken}"`).toMatch(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\b/);
    expect(spoken, `announced the short form: "${spoken}"`).not.toMatch(/\b(Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/);
});

// ── A STARTER'S TRAINING WEEKS (v25.40, owner 6 Nov 2026) ───────────────────────────────────────
//
// M. Campbell's weekdays from her start to 6 Nov are a bare 'TRG' in her BASE pattern
// (fixedRoster[3]) — "Training flavour with no shift times". The data is pinned in
// roster-data.test.mjs; this is what a member SEES, which no unit test reaches: the Training badge
// and no time in the cell, the full word on the panel, and the same day in Team Week. Until v25.40
// the Other family only ever arrived as an override, so a base Other day had never been drawn.
test('training weeks: a base Training day shows the badge and no time, on the calendar and in Team Week', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-14T09:00:00Z'));
    await seedMemberSession(page, 'M. Campbell');
    await page.goto('/');
    await expect(page.locator('.calendar-day').first()).toBeVisible();

    const cell = (/** @type {string} */ day) => page.locator(`.calendar-day:not(.other-month)[data-detail-day="${day}"]`);
    const wed = cell('Wednesday 14 October 2026');
    await expect(wed).toHaveAttribute('data-detail-shift-value', 'TRG');
    await expect(wed).toHaveClass(/\bother-day\b/);
    await expect(wed.locator('.shift-badge')).toContainText('Train');
    await expect(wed.locator('.shift-time')).toHaveCount(0);       // no time: the whole of the ask
    await expect(cell('Saturday 17 October 2026')).toHaveAttribute('data-detail-shift-value', 'RD');

    await wed.click();
    await expect(page.locator('#dayDetailShiftWords')).toHaveText('Training');
    await expect(page.locator('#dayDetailShiftTime')).toBeHidden();
    await page.locator('#dayDetailClose').click();

    // Team Week asks the same resolver. Today's week runs Sunday 11 to Saturday 17 October, so
    // Wednesday is the fourth cell of her row.
    await page.locator('#teamViewBtn').click();
    const row = page.locator('tr', { has: page.locator('th.tv-name-col', { hasText: 'M. Campbell' }) });
    await expect(row.locator('td.tv-cell').nth(3)).toHaveAttribute('aria-label', 'Training');
    await expect(row.locator('td.tv-cell').nth(3)).toHaveText('🏷️ Train');
});

// A worked shift's label in Team Week reads as the Calendar's day panel does — "Early shift 06:00-14:00",
// never "early shift …" — one spelling, SHIFT_KIND_LABELS (whole-app review, 24 Nov 2026).
test('team week: a worked shift is labelled in the Calendar\'s words', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-14T09:00:00Z'));
    await seedMemberSession(page, 'M. Campbell');
    await page.goto('/');
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    await page.locator('#teamViewBtn').click();
    const worked = page.locator('td.tv-cell.tv-early, td.tv-cell.tv-late, td.tv-cell.tv-night');
    await expect(worked.first()).toBeVisible();
    const labels = await worked.evaluateAll(els => els.map(el => el.getAttribute('aria-label')));
    expect(labels.length).toBeGreaterThan(0);
    for (const l of labels) expect(l).toMatch(/^(Early|Late|Night) shift \d\d:\d\d-\d\d:\d\d$/);
});

// ── THE TEAM WEEK JUMP (v23.64) ───────────────────────────────────────────────
// Prev/Next move one week at a time, so the label is the only way to reach a week that is not
// adjacent. The RULES are elsewhere — `getSunday` is the team view's own and already exercised by
// every render — so what is pinned here is the WIRING, which is all a browser can see: that the
// label reaches the app's own picker at all, and that the week it lands on is the week containing
// the picked day rather than the one before it.
//
// TWO THINGS MAKE THE SECOND HALF BITE, and without either it passes with the bug in — measured,
// not assumed. The value holder is an `<input type="date">` whose value is a bare `YYYY-MM-DD`, and
// `new Date(str)` on one of those is UTC MIDNIGHT: the previous day anywhere behind UTC. So
//   · the context runs at UTC−11, because CI runs in UTC where the two parses agree; and
//   · the picked day is a SUNDAY, because sliding back one day only changes the WEEK there.
// With both, the buggy parse lands a week early and the label is visibly wrong. With the first cut
// of this test — UTC, an arbitrary day — swapping in `new Date(...)` passed.
test.describe('the team week jump', () => {
    test.use({ timezoneId: 'Pacific/Midway' });   // UTC−11, no DST

    test('calendar: the week label opens the app\'s own picker and lands on the picked week', async ({ page }) => {
        // A PINNED clock, mid-month. The picker draws only the month on screen, so a week that runs into the
        // next month is banded on its days in THIS month and no others — by design (date-picker.js). Run on the
        // live date, this test failed every week that straddles a month end: first on Mon 28 Sep 2026, when
        // Sun 27 Sep – Sat 3 Oct showed four banded days. Wed 16 Sep 2026 09:00 UTC is Tue 15 Sep 22:00 in
        // Midway, inside Sun 13 – Sat 19 Sep, as the Admin picker's own test pins it (admin.spec.js).
        await page.clock.setFixedTime(new Date('2026-09-16T09:00:00Z'));
        await seedMember(page);
        await seedMemberSession(page);
        await page.setViewportSize({ width: 390, height: 820 });
        await page.goto('/');
        await page.waitForSelector('.control-group--actions', { state: 'attached' });
        await page.locator('#teamViewBtn').click();
        await page.waitForSelector('.team-week-text');

        // The OS picker would not be in the page at all — this asserts the app drew its own.
        await page.locator('#tvWeekJump').click();
        await expect(page.locator('#datePickerLightbox')).toBeVisible();
        await expect(page.locator('#dpTitle')).toHaveText('Jump to a week');
        // Team View's week runs Sunday–Saturday, like Admin's, so its picker is the WEEK picker:
        // Sunday first, and the week on screen banded as one row of seven.
        expect((await page.locator('.dp-dow').allInnerTexts()).join(''), 'Sunday is the first column').toBe('SMTWTFS');
        await expect(page.locator('.dp-day.dp-inweek')).toHaveCount(7);

        // A Sunday ~10 weeks out: far enough that Prev/Next could not have produced it by accident,
        // and a Sunday for the reason in the header.
        const target = await page.evaluate(() => {
            const d = new Date(); d.setDate(d.getDate() + 70);
            while (d.getDay() !== 0) d.setDate(d.getDate() + 1);
            const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            const sat = new Date(d); sat.setDate(sat.getDate() + 6);
            return { iso, sunDate: d.getDate(), satDate: sat.getDate() };
        });

        // The picker opens on the month the label is currently in, so walk forward to the target
        // month. Bounded, and it fails by name rather than spinning if the cell never appears.
        const cell = page.locator(`.dp-day[data-iso="${target.iso}"]`);
        for (let i = 0; i < 6 && await cell.count() === 0; i++) await page.locator('#dpNext').click();
        await expect(cell, `the picker never reached ${target.iso}`).toHaveCount(1);
        await cell.click();

        await expect(page.locator('#datePickerLightbox')).toBeHidden();
        const label = await page.locator('.team-week-text').innerText();
        // The label is "8–14 Sep 2026" or "29 Sep–5 Oct 2026" — both open with the Sunday's date and
        // carry the Saturday's, so both ends are checked without restating the formatter.
        expect(label, `week label after picking Sunday ${target.iso}`).toMatch(new RegExp(`^${target.sunDate}\\b`));
        expect(label).toContain(String(target.satDate));
    });

    // FOCUS FOLLOWS THE PICK (shared-ui-4). The pick rebuilds the week row, and Team View focuses the
    // NEW label in its `change` handler. The picker announced the pick while still open, so its focus
    // guard pulled that focus straight back into the closing picker — and it fell to <body> when the
    // picker hid, so the next Tab started from the top of the page.
    test('calendar: a week picked from the keyboard leaves focus on the rebuilt week label', async ({ page }, info) => {
        test.skip(isTouchProject(info), 'a keyboard');
        await page.clock.setFixedTime(new Date('2026-09-16T09:00:00Z'));
        await seedMember(page);
        await seedMemberSession(page);
        await page.goto('/');
        await page.waitForSelector('.control-group--actions', { state: 'attached' });
        await page.locator('#teamViewBtn').click();
        await page.waitForSelector('.team-week-text');
        const before = await page.locator('.team-week-text').innerText();
        await page.locator('#tvWeekJump').focus();
        await page.keyboard.press('Enter');
        await expect(page.locator('#datePickerLightbox')).toBeVisible();
        await expect(page.locator('#dpGrid .dp-day:focus'), 'it opens on the chosen day').toHaveCount(1);
        await page.keyboard.press('ArrowDown');   // the same day, a week on
        await page.keyboard.press('Enter');
        await expect(page.locator('#datePickerLightbox')).toBeHidden();
        await expect(page.locator('.team-week-text')).not.toHaveText(before);
        await expect(page.locator('#tvWeekJump'), 'focus is on the label the pick rebuilt, not on <body>').toBeFocused();
    });
});

// Team View opens on the month the reader is ON. `weekStartForMonth` is unit-tested in
// team-week-start.test.mjs; what NO unit test can see is `calendar-app.js` actually passing the
// `getDisplayedMonth` dep — the rule is optional by design (it falls back to today when the dep is
// missing), so dropping the call site restores the exact reported defect with every unit test green.
// Teeth-verified: deleting that one line from calendar-app.js fails this test and nothing else.
test('calendar: Team View opens on the month you were browsing, not the current week', async ({ page }) => {
    await seedMember(page);
    await seedMemberSession(page);
    await page.setViewportSize({ width: 390, height: 820 });
    await page.goto('/');
    await page.waitForSelector('.control-group--actions', { state: 'attached' });

    // Three months forward — past any week that today's week could reach by accident.
    const thisMonth = await page.locator('.month-year').innerText();
    for (let i = 0; i < 3; i++) await page.locator('#nextMonth').click();
    await expect(page.locator('.month-year')).not.toHaveText(thisMonth);
    const browsing = await page.locator('.month-year').innerText();

    await page.locator('#teamViewBtn').click();
    await page.waitForSelector('.team-week-text');
    const label = await page.locator('.team-week-text').innerText();

    // The expected week is derived from what the calendar SAYS it is showing, not from a second
    // copy of the month maths — so a heading that disagrees fails here rather than cancelling out.
    const want = await page.evaluate((heading) => {
        const [name, year] = heading.trim().split(/\s+/);
        const month = new Date(`${name} 1, ${year}`).getMonth();
        const first = new Date(Number(year), month, 1);
        const sun = new Date(first); sun.setDate(sun.getDate() - sun.getDay());
        // MONTH_ABB is MONTH_NAMES sliced to three, so the heading already carries it.
        return { sunDate: sun.getDate(), tail: `${name.slice(0, 3)} ${year}` };
    }, browsing);

    // The label opens with the Sunday's date and closes with the browsing month and year — the
    // Saturday of the week containing the 1st is always in that month, whichever side the Sunday
    // falls. Both ends together are what separates this week from today's.
    expect(label, `team week label while browsing ${browsing}`).toMatch(new RegExp(`^${want.sunDate}\\b`));
    expect(label, `team week label while browsing ${browsing}`).toMatch(new RegExp(`${want.tail}$`));
});

// ACROSS NEW YEAR (18 Nov 2026): the one week a year that starts in December and ends in January read
// "27 Dec–2 Jan 2027", putting 27 December in 2027. Both years now, on the label and in what is spoken.
test('calendar: a Team View week across New Year names both years, shown and spoken', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-11-18T09:00:00Z'));
    await seedMember(page);
    await page.goto('/?date=2027-01-05');
    await expect(page.locator('.month-year')).toHaveText('January 2027');
    await page.locator('#teamViewBtn').click();   // opens on the week holding 1 January
    await expect(page.locator('#tvWeekJump')).toHaveText('27 Dec 2026–2 Jan 2027');
    await page.locator('#tvPrevWeek').click();
    await expect(page.locator('#tvWeekJump'), 'a week inside one year keeps its one year').toHaveText('20–26 Dec 2026');
    await page.locator('#tvNextWeek').click();
    await expect.poll(() => page.locator('#ariaAnnouncer').textContent()).toBe('Week of 27 December 2026–2 January 2027');
});

// ── THE TEAM WEEK'S DATE ROW STAYS ABOVE THE NAMES ON A PHONE (7 Nov 2026, iPhone audit) ─────────
//
// `.team-table-wrap { overflow-x: auto }` makes the wrapper the header's scroll container, and the
// other axis then computes to `auto` too — so below 1024px, where nothing limited its height, the
// wrapper was as tall as the table, never scrolled, and the sticky date row went off the top with
// the page. A member reading the twentieth name had no day or date above the column. Now the
// wrapper is capped there and the names scroll under the date row inside it.
//
// The assertion that bites is "a name other than the first is directly under the date row": with
// the header gone off the screen, or moving WITH the names, the row beneath it is the first one at
// every size. Landscape is in the list because there the page must scroll as well, and every row
// still has to be reachable.
//
// THE DESKTOP HAD IT TOO (desktop audit, Nov 2026), whatever index.css's comment said: at 1366×650 the
// page scrolled 284px and the date row ended at −35px. And at 1920×1080, where the grade fits, the
// card ran 146px past its last name — so there the assertion is the other one: the box ends where the
// table does.
for (const [width, height] of [[375, 667], [390, 844], [667, 375], [1366, 650], [1920, 1080]]) {
    test(`calendar: the Team View date row stays above the names as they scroll, at ${width}×${height}`, async ({ page }) => {
        await page.setViewportSize({ width, height });
        await seedMemberSession(page, 'G. Miller');
        await page.goto('/');
        await expect(page.locator('.calendar-day').first()).toBeVisible();
        await page.locator('#teamViewBtn').click();
        await expect(page.locator('.team-table tbody tr').nth(15), 'a grade long enough to need scrolling').toBeAttached();

        // The page as far down as it goes, and the names as far down as THEY go — together, the
        // furthest a member can scroll towards the last name.
        const g = await page.evaluate(() => {
            window.scrollTo(0, document.documentElement.scrollHeight);
            const wrap = /** @type {HTMLElement} */ (document.querySelector('.team-table-wrap'));
            wrap.scrollTop = wrap.scrollHeight;
            const box = (/** @type {Element} */ e) => e.getBoundingClientRect();
            // A header CELL, not the thead: `position: sticky` moves the cells, and the thead's own
            // box stays where it was laid out.
            const head = box(/** @type {Element} */ (document.querySelector('.team-table thead th:nth-child(2)')));
            const w = box(wrap);
            const rows = [...document.querySelectorAll('.team-table tbody tr')];
            const under = document.elementFromPoint(w.left + w.width / 2, head.bottom + 4)?.closest('tr');
            return { vh: innerHeight, head, w, last: box(rows[rows.length - 1]), under: under ? rows.indexOf(under) : -1,
                fits: wrap.scrollHeight <= wrap.clientHeight,
                table: box(/** @type {Element} */ (document.querySelector('.team-table'))) };
        });
        expect(g.head.top, 'the date row is off the top of the screen').toBeGreaterThanOrEqual(0);
        expect(g.head.bottom, 'the date row is off the bottom of the screen').toBeLessThanOrEqual(g.vh);
        expect(Math.abs(g.head.top - g.w.top), 'the date row is not at the top of the box the names scroll in').toBeLessThanOrEqual(1);
        if (g.fits) {
            // A grade the screen has room for: nothing to scroll, and nothing drawn past its last name.
            expect(width, 'premise: only a large screen holds the whole grade').toBeGreaterThan(1024);
            expect(Math.round(g.w.bottom - g.table.bottom), 'an empty band runs below the last name').toBeLessThanOrEqual(1);
            return;
        }
        expect(g.under, 'the first name is still under the date row — nothing scrolled beneath it').toBeGreaterThan(0);
        expect(g.last.bottom, 'the last name cannot be brought on screen').toBeLessThanOrEqual(Math.min(g.vh, g.w.bottom) + 1);
        expect(g.w.top, 'scrolled to the end, the box the names scroll in is still above the screen').toBeGreaterThanOrEqual(0);

        // The name column holds when the week scrolls sideways — the other sticky edge of the same
        // box. Held sideways the phone is wide enough for all seven days, so there is nothing to scroll.
        if (width > 600) return;
        const side = await page.evaluate(() => {
            const wrap = /** @type {HTMLElement} */ (document.querySelector('.team-table-wrap'));
            wrap.scrollLeft = wrap.scrollWidth;
            const left = (/** @type {string} */ s) => /** @type {Element} */ (document.querySelector(s)).getBoundingClientRect();
            const names = document.querySelectorAll('.team-table tbody th.tv-name-col');
            return { scrolled: wrap.scrollLeft, wrap: left('.team-table-wrap'), name: names[names.length - 1].getBoundingClientRect(),
                headName: left('.team-table thead th.tv-name-col') };
        });
        expect(side.scrolled, 'the week did not need to scroll sideways at this width').toBeGreaterThan(0);
        expect(Math.abs(side.name.left - side.wrap.left), 'the name column scrolled away with the days').toBeLessThanOrEqual(1);
        expect(Math.abs(side.headName.left - side.wrap.left), 'the "Name" heading scrolled away').toBeLessThanOrEqual(1);
        expect(Math.abs(side.headName.top - side.wrap.top), 'the "Name" heading left the top edge').toBeLessThanOrEqual(1);
    });
}

// …and on PAPER the cap is lifted. A sheet is under 1024px wide, so the phone rule matches in print
// too, and a printed grade would stop at the first screenful of names, with nothing to say so.
test('calendar: a printed Team View is not cut to the phone\'s scroll box', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 420 });   // a box of 210px, under the printed table
    await seedMemberSession(page, 'G. Miller');
    await page.goto('/');
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    await page.locator('#teamViewBtn').click();
    await expect(page.locator('.team-table tbody tr').nth(15)).toBeAttached();
    await page.emulateMedia({ media: 'print' });
    const h = await page.evaluate(() => ({
        wrap: /** @type {Element} */ (document.querySelector('.team-table-wrap')).getBoundingClientRect().height,
        table: /** @type {Element} */ (document.querySelector('.team-table')).getBoundingClientRect().height,
    }));
    expect(h.wrap, `the printed grade is cut to a ${Math.round(h.wrap)}px box of a ${Math.round(h.table)}px table`)
        .toBeGreaterThanOrEqual(h.table - 1);
    await page.emulateMedia({ media: 'screen' });
});

// …and on a phone the names run to the foot of their card (owner's phone, 10 Nov 2026). From v25.49 the
// box's height was worked out beside the card, the screen less 250px, while the card reached the foot of
// the screen by its own route. Wherever the two disagreed, an empty band showed under the last name: 27px
// on any phone, 82px on the owner's, where the page came out 55px taller than the screen. The box now
// takes what the card has left. The second case stands in for that phone: a test browser never makes the
// page taller than the screen by itself, so it is made so here, as the phone made it.
// THE STRIPS ARE ANSWERED FIRST, as on the owner's phone and on every device after its first visits:
// the notifications strip, which a test browser shows (permission never asked), and on the iPhone engine
// the install strip, which outranks it. Either stands above the card and soaks up the band, so with one
// on screen the old rule passed this test (measured: every size on Chrome, every size on the iPhone).
// THE BAND IS MEASURED TO THE CARD'S LAST THING SHOWN: the swipe hint where a touch screen still shows
// it, the box everywhere else. The floor has its own assertion, because only a short screen reaches it
// and nothing else here would notice it gone.
for (const [width, height, taller] of [[360, 695, 0], [360, 695, 55], [390, 844, 0], [667, 375, 0]]) {
    test(`calendar: the Team View table fills its card at ${width}×${height}${taller ? `, the page ${taller}px taller than the screen` : ''}`, async ({ page }) => {
        await page.setViewportSize({ width, height });
        await seedMemberSession(page, 'G. Miller');
        await page.addInitScript(() => {
            for (const k of ['myb_notif_prompt_done', 'myb_install_prompt_done']) { try { localStorage.setItem(k, '1'); } catch { /* private mode */ } }
        });
        await page.goto('/');
        await expect(page.locator('.calendar-day').first()).toBeVisible();
        await expect(page.locator('#notifPrompt'), 'premise: no notifications strip above the card').toBeHidden();
        await expect(page.locator('#installPrompt'), 'premise: no install strip above the card').toBeHidden();
        if (taller) await page.addStyleTag({ content: `body { min-height: calc(100dvh + ${taller}px) !important; }` });
        await page.locator('#teamViewBtn').click();
        await expect(page.locator('.team-table tbody tr').nth(15), 'a grade long enough to need scrolling').toBeAttached();
        const g = await page.evaluate(() => {
            const card = /** @type {Element} */ (document.querySelector('.team-view-container'));
            const shown = [...card.children].filter(e => e.getBoundingClientRect().height > 0);
            const box = (/** @type {string} */ s) => /** @type {Element} */ (document.querySelector(s)).getBoundingClientRect();
            return { vh: innerHeight, card: card.getBoundingClientRect().bottom, last: shown[shown.length - 1].getBoundingClientRect().bottom,
                wrap: box('.team-table-wrap').height, table: box('.team-table').height, pageH: document.documentElement.scrollHeight };
        });
        expect(g.table, 'premise: a grade taller than its box, or there is nothing to fill').toBeGreaterThan(g.wrap);
        if (taller) expect(g.pageH - g.vh, 'premise: the page is taller than the screen, as on the owner\'s phone').toBeGreaterThanOrEqual(taller - 1);
        expect(Math.round(g.card - g.last), 'an empty band runs under the last name').toBeLessThanOrEqual(1);
        expect(g.wrap, 'the box is under half the screen: two or three rows where the screen is short').toBeGreaterThanOrEqual(g.vh / 2 - 1);
    });
}

// …and on a laptop the card ends where the month does (laptop polish, 13 Nov 2026). From 1024px the box
// is capped at the window less what stands round it, written as a constant, and 280px left a 25px navy
// band under the card at every laptop size, where the month's key and the page's sides have 16px. The
// band is measured against the body's own bottom padding, not a number, and the page must not scroll:
// on Windows a fraction of a pixel over the window draws a scrollbar.
for (const [width, height] of /** @type {const} */ ([[1024, 600], [1280, 593], [1366, 650], [1536, 735]])) {
    test(`calendar: on a laptop the Team View card ends where the month does, ${width}×${height}`, async ({ page }, info) => {
        test.skip(isTouchProject(info), 'a laptop window');
        await page.setViewportSize({ width, height });
        await seedMemberSession(page, 'G. Miller');
        await page.addInitScript(() => {
            for (const k of ['myb_notif_prompt_done', 'myb_install_prompt_done']) { try { localStorage.setItem(k, '1'); } catch { /* private mode */ } }
        });
        await page.goto('/');
        await expect(page.locator('.calendar-day').first()).toBeVisible();
        await expect(page.locator('#notifPrompt'), 'premise: no notifications strip above the card').toBeHidden();
        await page.locator('#teamViewBtn').click();
        await expect(page.locator('.team-table tbody tr').nth(15), 'a grade long enough to need scrolling').toBeAttached();
        const g = await page.evaluate(() => {
            const box = (/** @type {string} */ s) => /** @type {Element} */ (document.querySelector(s)).getBoundingClientRect();
            return { vh: innerHeight, below: innerHeight - box('.team-view-container').bottom,
                pad: parseFloat(getComputedStyle(document.body).paddingBottom),
                wrap: box('.team-table-wrap').height, table: box('.team-table').height, pageH: document.documentElement.scrollHeight };
        });
        expect(g.table, 'premise: a grade taller than its box, so the cap is what sets the card').toBeGreaterThan(g.wrap);
        expect(g.pageH, 'the page does not scroll').toBeLessThanOrEqual(g.vh);
        expect(g.below, `the band under the card is ${g.below.toFixed(1)}px, the page's own margin is ${g.pad}px`).toBeLessThanOrEqual(g.pad + 2);
        expect(g.below).toBeGreaterThanOrEqual(g.pad);
    });
}

// …and its help is reachable whole there. Until 25 Nov 2026 it was a glass panel of its own, sized to be read
// without scrolling on a 593px window (laptop polish, 13 Nov 2026). It is the app's shared white Tips panel now
// (owner: every ? looks the same), which scrolls on a short window as every other page's does — so what must hold
// is the shared panel's own promise: it stays inside the window, and scrolled to its end its title and ✕ are still
// in sight, so nothing reads as cut off with no way out.
for (const [width, height] of /** @type {const} */ ([[1280, 593], [1366, 650]])) {
    test(`calendar: on a laptop the Team View help stays in the window, its title in sight when scrolled, ${width}×${height}`, async ({ page }, info) => {
        test.skip(isTouchProject(info), 'a laptop window');
        await page.setViewportSize({ width, height });
        await seedMemberSession(page, 'G. Miller');
        await page.goto('/');
        await expect(page.locator('.calendar-day').first()).toBeVisible();
        await page.locator('#teamViewBtn').click();
        await page.locator('#teamHelpBtn').click();
        await expect(page.locator('#tipsLightbox')).toHaveClass(/\bopen\b/);
        await expect(page.locator('#tipsLbTitle')).toHaveText('Team Week View');
        const g = await page.locator('#tipsLightboxContent').evaluate(el => {
            el.scrollTop = el.scrollHeight;
            const r = el.getBoundingClientRect();
            const t = /** @type {HTMLElement} */ (document.getElementById('tipsLbTitle')).getBoundingClientRect();
            return { top: r.top, bottom: r.bottom, vh: innerHeight, titleTop: t.top };
        });
        expect(g.top, 'the panel starts inside the window').toBeGreaterThanOrEqual(0);
        expect(g.bottom, 'the panel ends inside the window').toBeLessThanOrEqual(g.vh);
        expect(g.titleTop, 'scrolled to its end, the title is still at the top of the panel').toBeGreaterThanOrEqual(g.top);
    });
}

// …and a scroll DOWN the names is not the swipe the hint asks for (7 Nov 2026). With the box capped,
// the names scroll inside it, and the hint ("← Swipe table to see all 7 days →") was retired by the
// first scroll of any kind — so somebody reading down the list lost it, for good, before the week had
// ever moved. So was the APP's own move: it brings today into view (a pixel or two even on a Sunday)
// and puts the week back after a grade switch, and either retired the hint within a frame, unread.
// EACH STEP WAITS UNTIL THE BOX'S SCROLL EVENT HAS BEEN DELIVERED, never for a fixed time. WebKit
// delivers it late — measured: nothing two frames after the scroll, the event by 600ms, and one event
// per box however many moves came before it — so on the iPhone engine a fixed wait could read the
// hint before the app had heard the scroll: a "keeps the hint" step passed without testing anything,
// and the swipe that should retire it failed.
test('calendar: scrolling down the Team View names keeps the swipe hint; scrolling across the week retires it', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.clock.setFixedTime(new Date('2026-11-12T09:00:00Z'));      // a Thursday: the open scrolls to today
    await seedMemberSession(page, 'G. Miller');
    await page.goto('/');
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    /** Arm a wait for the next scroll event on the box a step is about: the one there now, or with
     *  `fresh` the one the app is about to draw. It is caught on its way down (capture) and answered a
     *  task later, so the app's own listener on the box has run by the time it resolves; false if
     *  none comes. @param {boolean} fresh */
    const armScrollWait = (fresh) => page.evaluate((freshBox) => {
        const before = document.querySelector('.team-table-wrap');
        /** @type {any} */ (window).__boxScrolled = new Promise((resolve) => {
            /** @param {Event} e */
            const on = (e) => {
                const box = e.target;
                if (!(box instanceof Element) || !box.classList.contains('team-table-wrap')) return;
                if (freshBox ? box === before : box !== before) return;
                document.removeEventListener('scroll', on, true);
                setTimeout(() => resolve(true), 0);
            };
            document.addEventListener('scroll', on, true);
            setTimeout(() => { document.removeEventListener('scroll', on, true); resolve(false); }, 5000);
        });
    }, fresh);
    const scrollHeard = () => page.evaluate(() => /** @type {any} */ (window).__boxScrolled);
    const state = () => page.evaluate(() => ({
        seen: localStorage.getItem('myb_team_scroll_seen'),
        hidden: /** @type {HTMLElement} */ (document.querySelector('.tv-scroll-hint')).style.display === 'none',
        top: /** @type {HTMLElement} */ (document.querySelector('.team-table-wrap')).scrollTop,
    }));

    await armScrollWait(true);
    await page.locator('#teamViewBtn').click();
    await expect(page.locator('.team-table tbody tr').nth(15)).toBeAttached();
    expect(await scrollHeard(), 'premise: the open brought today into view, and the box reported it').toBe(true);
    expect(await state(), 'the app bringing today into view retired the hint').toMatchObject({ seen: null, hidden: false });

    await armScrollWait(false);
    await page.evaluate(() => { /** @type {HTMLElement} */ (document.querySelector('.team-table-wrap')).scrollTop = 200; });
    expect(await scrollHeard(), 'premise: the box reported the scroll down the names').toBe(true);
    const down = await state();
    expect(down.top, 'premise: the names scrolled inside the box').toBeGreaterThan(0);
    expect(down, 'a scroll down the names retired the swipe hint').toMatchObject({ seen: null, hidden: false });

    // A grade tab re-draws the grid, and the app puts the week back where it was — its own move again.
    await armScrollWait(true);
    await page.locator('.grade-tab.active').click();
    await expect(page.locator('.team-table tbody tr').nth(15)).toBeAttached();
    expect(await scrollHeard(), 'premise: the app put the week back, and the new box reported it').toBe(true);
    expect(await state(), 'the app putting the week back after a grade switch retired the hint').toMatchObject({ seen: null, hidden: false });

    await armScrollWait(false);
    await page.evaluate(() => { /** @type {HTMLElement} */ (document.querySelector('.team-table-wrap')).scrollLeft = 120; });
    expect(await scrollHeard(), 'premise: the box reported the scroll across the week').toBe(true);
    expect(await state(), 'a scroll across the week did not retire the hint').toMatchObject({ seen: '1', hidden: true });
});

// …and the hint is for a table that SCROLLS (desktop audit follow-up, Nov 2026). `touch-only` showed
// it on any coarse pointer, so a tablet, a phone on its side or a touch laptop — seven days that fit —
// was told to swipe a table that does not move. It shows only while the box overflows: measured as the
// week is drawn, so the line arrives hidden rather than showing for a frame, and again whenever the box
// changes size, which the steps below do in place, with no redraw between. And a change of size is not
// the member's swipe: widening clamps the box's scroll back to the start, which retired the hint for
// good on a tablet that had only been turned round. Each scroll step waits for its event, as above.
test('Team View: the swipe hint shows only while the week is wider than its box', async ({ page }, info) => {
    test.skip(!isTouchProject(info), 'the hint is touch-only UI');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.clock.setFixedTime(new Date('2026-11-12T09:00:00Z'));      // a Thursday: the open scrolls to today
    await seedMemberSession(page, 'G. Miller');
    await page.goto('/');
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    const wrap = page.locator('.team-table-wrap');
    const hint = page.locator('.tv-scroll-hint');
    const overflows = () => wrap.evaluate(w => w.scrollWidth > w.clientWidth + 1);
    const retired = () => page.evaluate(() => localStorage.getItem('myb_team_scroll_seen'));
    /** Arm a wait for the next scroll the week's box reports, answered a task later so the app's own
     *  listener has run by then; false if none comes. */
    const armScrollWait = () => page.evaluate(() => {
        /** @type {any} */ (window).__boxScrolled = new Promise((resolve) => {
            /** @param {Event} e */
            const on = (e) => {
                if (!(e.target instanceof Element) || !e.target.classList.contains('team-table-wrap')) return;
                document.removeEventListener('scroll', on, true);
                setTimeout(() => resolve(true), 0);
            };
            document.addEventListener('scroll', on, true);
            setTimeout(() => { document.removeEventListener('scroll', on, true); resolve(false); }, 5000);
        });
    });
    const scrollHeard = () => page.evaluate(() => /** @type {any} */ (window).__boxScrolled);

    await armScrollWait();
    await page.locator('#teamViewBtn').click();
    await expect(page.locator('.team-table tbody tr').first()).toBeAttached();
    expect(await scrollHeard(), 'premise: the open brought Thursday into view, and the box reported it').toBe(true);
    expect(await overflows(), 'premise: on a phone the seven days are wider than the screen').toBe(true);
    await expect(hint, 'a phone is told how to see the rest of the week').toBeVisible();

    await armScrollWait();
    await page.setViewportSize({ width: 1366, height: 1024 });                  // the same box, widened
    expect(await scrollHeard(), 'premise: widened, the box clamped its scroll back to the start and said so').toBe(true);
    expect(await overflows(), 'premise: widened, the week fits its box').toBe(false);
    await expect(hint, 'widened in place, the box stopped scrolling, and the hint went with it').toBeHidden();
    expect(await retired(), 'the box clamping its scroll on a resize was taken for the member\'s swipe').toBeNull();

    // A wide touch screen from the first draw: back to the month, then into the week again, recording
    // each hint the week draws as it arrives — after the render, before any frame could paint it.
    await page.locator('#teamViewBtn').click();
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    await page.evaluate(() => {
        const arrivals = /** @type {boolean[]} */ ((/** @type {any} */ (window)).__hintArrivals = []);
        new MutationObserver((records) => {
            for (const r of records) for (const n of r.addedNodes) {
                if (!(n instanceof Element)) continue;
                const h = n.matches('.tv-scroll-hint') ? n : n.querySelector('.tv-scroll-hint');
                if (h) arrivals.push(/** @type {HTMLElement} */ (h).hidden);
            }
        }).observe(document.body, { childList: true, subtree: true });
    });
    await page.locator('#teamViewBtn').click();
    await expect(page.locator('.team-table tbody tr').first()).toBeAttached();
    expect(await overflows(), 'premise: drawn at 1366px, the week fits').toBe(false);
    await expect(hint, 'a table that does not scroll is not offered a swipe').toBeHidden();
    const arrivals = await page.evaluate(() => /** @type {any} */ (window).__hintArrivals);
    expect(arrivals.length, 'premise: the week drew its hint').toBeGreaterThan(0);
    expect(arrivals, 'the hint arrived showing, to be taken away a frame later').not.toContain(false);

    await page.setViewportSize({ width: 390, height: 844 });                    // and narrowed in place
    await expect.poll(overflows, { message: 'premise: narrowed, the week overflows again' }).toBe(true);
    await expect(hint, 'narrowed in place, the table scrolls again and the hint is back').toBeVisible();
    expect(await retired(), 'nothing on the way was the member\'s swipe').toBeNull();
});

// ─── "WHO’S ON WITH ME" (owner, 27 Nov 2026) ─────────────────────────────────────────────────────────
// The day panel's button on a day worked with times, today or later, opens Team View on that date's week,
// with the colleagues whose duties overlap listed above the grid by role, in order of start. The arithmetic is
// team-overlap.test.mjs's and the card's markup calendar-team-onwith.test.mjs's; this is the WIRING — the
// cell's date and times reaching the panel, the panel's close waiting for its Back before Team View pushes
// its own (`whenHistorySettled`), the card drawn from the shared cache, focus, Hide, and one Back out.
/** Three current CEAs other than G. Miller, from the roster by position, so no name is written here. */
const onWithCast = () => teamMembers.filter(m => !m.hidden && m.role === 'CEA' && m.name !== 'G. Miller'
    && !(m.startDate && m.startDate > new Date(2026, 8, 15))).slice(0, 3);
/** @param {import('@playwright/test').Page} page */
async function seedOnWithDay(page) {
    const [early, long, away] = onWithCast();
    await page.clock.setFixedTime(new Date('2026-09-16T09:00:00Z'));
    await page.addInitScript(({ early, long, away }) => {
        const w = /** @type {any} */ (window); w.__E2E = w.__E2E || {};
        const row = (/** @type {string} */ id, /** @type {string} */ memberName, /** @type {string} */ type, /** @type {string} */ value) =>
            ({ id, memberName, date: '2026-09-16', type, value, note: '' });
        w.__E2E.docs = [
            row('ow1', 'G. Miller', 'shift', '14:00-22:30'),
            row('ow2', early, 'shift', '06:00-15:00'),        // the owner's example: together 14:00–15:00
            row('ow3', long, 'shift', '13:00-21:00'),         // together seven hours, so listed before it
            row('ow4', away, 'annual_leave', 'AL'),           // on leave: never listed
        ];
    }, { early: early.name, long: long.name, away: away.name });
    return { early, long, away };
}

test('team view: "Who’s on with me" opens the week on that date with the overlap card, and one Back returns to the month', async ({ page }) => {
    const { early, long, away } = await seedOnWithDay(page);
    expect(away, 'premise: the roster has three CEAs besides G. Miller').toBeTruthy();
    await page.goto('/railcard-guide.html');              // where the member came from
    await page.goto('/');
    const day = page.locator('.calendar-day[data-detail-iso="2026-09-16"]');
    await expect(day).toHaveAttribute('data-detail-worked-times', '14:00-22:30');
    const entries = await page.evaluate(() => history.length);
    await day.click();
    const btn = page.locator('#dayDetailTeamBtn');
    await expect(btn).toBeVisible();
    await expect(btn).toHaveAccessibleName('Who’s on with me');
    await btn.click();

    const card = page.getByRole('region', { name: 'On with G. Miller Wednesday 16 September' });
    await expect(card).toBeVisible();
    await expect(page.locator('#tvOnWithTitle'), 'focus did not move to the answer').toBeFocused();
    await expect(page.locator('#tvWeekJump')).toHaveText('13–19 Sep 2026');
    await expect(page.locator('.team-table'), 'the week grid is not under the card').toBeVisible();
    const row = (/** @type {string} */ name) => card.locator('.tv-onwith-row', { has: page.locator('.tv-onwith-name', { hasText: name }) });
    await expect(row(early.name)).toContainText('until 15:00');
    await expect(row(long.name)).toContainText('until 21:00');
    const names = await card.locator('.tv-onwith-name').allTextContents();
    expect(names.indexOf(early.name), 'the 06:00 start was not listed before the 13:00').toBeLessThan(names.indexOf(long.name));
    await expect(card.getByRole('heading', { level: 3 }), 'not by role, the member\'s own first').toHaveText(['CEA', 'CES', 'Dispatcher']);
    await expect(card.getByRole('list', { name: 'CEA' }).locator('.tv-onwith-name')).toContainText([early.name, long.name]);
    await expect(card, 'somebody on leave was listed').not.toContainText(away.name);
    await expect(card.locator('.tv-onwith-name', { hasText: 'G. Miller' }), 'the member was listed as on with themselves').toHaveCount(0);

    // ONE entry for Team View, the panel's own gone first. Pushed before the panel's Back had landed, the
    // panel's entry survived beneath Team View's (history.length one higher), an entry nothing answers.
    expect(await page.evaluate(() => history.length), 'the panel\'s history entry was left behind').toBe(entries + 1);
    await page.goBack();
    await expect(page.locator('.calendar-day').first(), 'one Back did not return to the month').toBeVisible();
    await expect(page.locator('#tvOnWith')).toHaveCount(0);
    expect(await page.evaluate(() => history.state?.mybOverlay ?? null), 'Back landed on an overlay\'s entry').toBeNull();
    await page.goBack();
    await expect(page, 'one more Back leaves the Calendar').toHaveURL(/\/railcard-guide\.html$/);
});

test('team view: Hide puts the plain week back, and another week drops the card', async ({ page }) => {
    await seedOnWithDay(page);
    await page.goto('/');
    await page.locator('.calendar-day[data-detail-iso="2026-09-16"]').click();
    await page.locator('#dayDetailTeamBtn').click();
    const card = page.locator('#tvOnWith');
    await expect(card).toBeVisible();
    await page.locator('#tvOnWithHide').click();
    await expect(card).toHaveCount(0);
    await expect(page.locator('.team-table'), 'Hide left Team View').toBeVisible();
    await expect(page.locator('#tvWeekJump')).toBeFocused();

    // Opened again, then the week moved: the card belongs to its date and does not follow.
    await page.locator('#teamViewBtn').click();
    await page.locator('.calendar-day[data-detail-iso="2026-09-16"]').click();
    await page.locator('#dayDetailTeamBtn').click();
    await expect(card).toBeVisible();
    await page.locator('#tvNextWeek').click();
    await expect(card).toHaveCount(0);
    await page.locator('#tvPrevWeek').click();
    await expect(card, 'coming back to the week brought the card back').toHaveCount(0);
});

test('team view: a rest day offers no "Who’s on with me", and a colleague’s day names them', async ({ page }) => {
    await seedOnWithDay(page);
    const colleague = onWithCast()[0];
    await page.goto('/');
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    const rest = await page.evaluate(() => [...document.querySelectorAll('.calendar-day:not(.other-month)')]
        .findIndex(c => /** @type {HTMLElement} */ (c).dataset.detailShiftValue === 'RD'));
    expect(rest, 'premise: the month has a rest day').toBeGreaterThan(-1);
    await page.locator('.calendar-day:not(.other-month)').nth(rest).click();
    await expect(page.locator('#dayDetailTeamBtn')).toBeHidden();
    await expect(page.locator('#dayDetailTeamBtn')).toHaveCSS('display', 'none');
    await page.locator('#dayDetailClose').click();

    await page.locator('#teamMemberSelect').selectOption({ label: colleague.name });
    await page.locator('.calendar-day[data-detail-iso="2026-09-16"]').click();
    await expect(page.locator('#dayDetailTeamBtn')).toHaveAccessibleName(`Who’s on with ${colleague.name}`);
    await page.locator('#dayDetailTeamBtn').click();
    await expect(page.getByRole('region', { name: `On with ${colleague.name} Wednesday 16 September` })).toBeVisible();
    await expect(page.locator('#tvOnWith .tv-onwith-name', { hasText: 'G. Miller' }), 'G. Miller (14:00–22:30) shares 14:00–15:00').toHaveCount(1);
});

// A TRAINING DAY WITH NO TIME OF ITS OWN IS ON THE BASE SHIFT'S HOURS (team-overlap.js, rules 6 and 7): the
// cell prints them, so the card must count them — for a colleague and for the member's own day alike.
/** A day of 16–19 Sep 2026 whose BASE shift is timed for `member`, as the cell would print it. From the
 *  16th, the tests' today: the card answers for today and later only. */
const timedBaseDay = (/** @type {any} */ member) => {
    for (let d = 16; d <= 19; d++) {
        const base = getBaseShift(member, new Date(2026, 8, d, 12));
        if (SHIFT_TIME_REGEX.test(base)) return { iso: `2026-09-${d}`, base };
    }
    return null;
};
/** @param {import('@playwright/test').Page} page @param {any[]} docs */
async function seedDocs(page, docs) {
    await page.clock.setFixedTime(new Date('2026-09-16T09:00:00Z'));
    await page.addInitScript((docs) => { const w = /** @type {any} */ (window); w.__E2E = w.__E2E || {}; w.__E2E.docs = docs; }, docs);
}

test('team view: a colleague on Training over the same hours is on with you, never "not at the same time"', async ({ page }) => {
    const trainee = /** @type {any} */ (onWithCast().find(m => timedBaseDay(m)));
    const at = trainee && timedBaseDay(trainee);
    expect(at, 'premise: a CEA with a timed base shift that week').toBeTruthy();
    const { iso, base } = /** @type {{ iso: string, base: string }} */ (at);
    await seedDocs(page, [
        { id: 'tr1', memberName: 'G. Miller', date: iso, type: 'shift', value: base, note: '' },
        { id: 'tr2', memberName: trainee.name, date: iso, type: 'other', value: 'TRG', note: '' },   // no time of its own
    ]);
    await page.goto('/');
    await page.locator(`.calendar-day[data-detail-iso="${iso}"]`).click();
    await page.locator('#dayDetailTeamBtn').click();
    const card = page.locator('#tvOnWith');
    await expect(card).toBeVisible();
    const row = card.locator('.tv-onwith-row', { has: page.locator('.tv-onwith-name', { hasText: trainee.name }) });
    await expect(row, 'a colleague on Training over the same hours was not listed as on with you').toContainText('Training');
    await expect(row).toContainText('whole shift');
    await expect(card, 'the old "not at the same time" list came back').not.toContainText('not at the same time');
});

test('team view: the member\'s own Training day on the base shift\'s hours offers "Who’s on with me"', async ({ page }) => {
    const me = teamMembers.find(m => m.name === 'G. Miller');
    const at = timedBaseDay(me);
    expect(at, 'premise: G. Miller has a timed base shift that week').toBeTruthy();
    const { iso, base } = /** @type {{ iso: string, base: string }} */ (at);
    await seedDocs(page, [{ id: 'tr3', memberName: 'G. Miller', date: iso, type: 'other', value: 'TRG', note: '' }]);
    await page.goto('/');
    const day = page.locator(`.calendar-day[data-detail-iso="${iso}"]`);
    await expect(day).toHaveAttribute('data-detail-shift-value', 'TRG');
    await expect(day, 'the cell\'s own times did not reach the panel').toHaveAttribute('data-detail-worked-times', base);
    await day.click();
    await expect(page.locator('#dayDetailTeamBtn'), 'a Training day on the base shift\'s hours offered no button').toBeVisible();
    await page.locator('#dayDetailTeamBtn').click();
    await expect(page.locator('#tvOnWith .tv-onwith-mine')).toContainText('Training');
    await expect(page.locator('#tvOnWith')).not.toContainText('has no shift with times');
});

// TODAY AND LATER ONLY (owner, 28 Nov 2026: "I do not need to see who I am on in the past with"). A past day
// worked with times offers no button; today and a later day do. A panel left open across midnight still
// has its button, and pressing it then opens the week with no card: the card's own rule, not the panel's.
test('team view: "Who’s on with me" is offered today and later, never on a past day', async ({ page }) => {
    await seedDocs(page, ['2026-09-15', '2026-09-16', '2026-09-17'].map((date, i) =>
        ({ id: `p${i}`, memberName: 'G. Miller', date, type: 'shift', value: '14:00-22:30', note: '' })));
    await page.goto('/');
    const btn = page.locator('#dayDetailTeamBtn');
    for (const [iso, offered] of /** @type {[string, boolean][]} */ ([['2026-09-15', false], ['2026-09-16', true], ['2026-09-17', true]])) {
        const day = page.locator(`.calendar-day[data-detail-iso="${iso}"]`);
        await expect(day, 'premise: a day worked with times').toHaveAttribute('data-detail-worked-times', '14:00-22:30');
        await day.click();
        await expect(page.locator('#dayDetailLightbox')).toHaveClass(/\bopen\b/);
        if (offered) await expect(btn, `${iso} offered no button`).toBeVisible();
        else await expect(btn, 'a past day offered "Who’s on with me"').toBeHidden();
        await page.locator('#dayDetailClose').click();
        await expect(page.locator('#dayDetailLightbox')).not.toHaveClass(/\bopen\b/);
    }
});

test('team view: a date gone past by the time the button is pressed opens the week with no card', async ({ page }) => {
    await page.clock.install({ time: new Date(2026, 8, 16, 23, 58, 0) });
    await page.addInitScript(() => {
        const w = /** @type {any} */ (window); w.__E2E = w.__E2E || {};
        w.__E2E.docs = [{ id: 'm1', memberName: 'G. Miller', date: '2026-09-16', type: 'shift', value: '14:00-22:30', note: '' }];
    });
    await page.goto('/');
    await page.locator('.calendar-day[data-detail-iso="2026-09-16"]').click();
    await expect(page.locator('#dayDetailTeamBtn')).toBeVisible();
    await page.clock.runFor('03:00');                     // past local midnight, the panel still open
    await page.locator('#dayDetailTeamBtn').click();
    await expect(page.locator('.team-table'), 'Team View did not open').toBeVisible();
    await expect(page.locator('#tvOnWith'), 'a card for a day now past').toHaveCount(0);
});

// BY ROLE, AND TIDY AT 320px (owner, 28 Nov 2026: "very ugly and clunky … needs to be by role"). One line a
// colleague: the name, the shift and the stretch together side by side, nothing past the card's edge.
test('team view: the "On with" card is by role and keeps every colleague to one line at 320px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    const ces = /** @type {any} */ (teamMembers.find(m => !m.hidden && m.role === 'CES'
        && !(m.startDate && m.startDate > new Date(2026, 8, 15))));
    await seedOnWithDay(page);
    await page.addInitScript((name) => {
        /** @type {any} */ (window).__E2E.docs.push({ id: 'ow5', memberName: name, date: '2026-09-16', type: 'rdw', value: '16:00-23:00', note: '' });
    }, ces.name);
    await page.goto('/');
    await page.locator('.calendar-day[data-detail-iso="2026-09-16"]').click();
    await page.locator('#dayDetailTeamBtn').click();
    const card = page.locator('#tvOnWith');
    await expect(card).toBeVisible();
    await expect(card.getByRole('heading', { level: 3 }), 'not by role, the member\'s own first').toHaveText(['CEA', 'CES', 'Dispatcher']);
    // Each role's list holds only that role: the Rest Day Working CES is under CES, not CEA.
    await expect(card.getByRole('list', { name: 'CES' }).locator('.tv-onwith-row', { hasText: ces.name })).toContainText('from 16:00');
    await expect(card.getByRole('list', { name: 'CEA' })).not.toContainText(ces.name);

    const rows = await card.evaluate((el) => {
        const box = el.getBoundingClientRect();
        const mid = (/** @type {DOMRect} */ r) => (r.top + r.bottom) / 2;
        return [...el.querySelectorAll('.tv-onwith-row')].map(row => {
            const parts = [...row.children].map(c => c.getBoundingClientRect());
            return {
                name: row.querySelector('.tv-onwith-name')?.textContent,
                oneLine: parts.every(p => Math.abs(mid(p) - mid(parts[0])) < 3) && row.getBoundingClientRect().height < 36,
                inside: parts.every(p => p.left >= box.left && p.right <= box.right - 1),
            };
        });
    });
    expect(rows.length, 'premise: rows to measure').toBeGreaterThan(3);
    for (const row of rows) {
        expect(row.oneLine, `${row.name}'s row wrapped`).toBe(true);
        expect(row.inside, `${row.name}'s row ran past the card`).toBe(true);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 'the page scrolls sideways').toBeLessThanOrEqual(0);
});

// TO THE SATURDAY ENDING THE WEEK THREE WEEKS ON, AND BOXING DAY (owner, 28 Nov 2026: "Apart from Boxing Day, the
// who's on with me button should only be active until the week ending Saturday 3 weeks ahead"). On Saturday 28
// November that Saturday is 19 December: the 19th offers the button, the Sunday after does not, and Boxing Day does.
test('team view: "Who’s on with me" is offered to the Saturday three weeks on, and on Boxing Day', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-11-28T09:00:00Z'));
    await page.addInitScript((docs) => { const w = /** @type {any} */ (window); w.__E2E = w.__E2E || {}; w.__E2E.docs = docs; },
        ['2026-12-19', '2026-12-20', '2026-12-26'].map((date, i) =>
            ({ id: `h${i}`, memberName: 'G. Miller', date, type: 'rdw', value: '08:00-16:00', note: '' })));
    await page.goto('/');
    await page.locator('#nextMonth').click();
    const btn = page.locator('#dayDetailTeamBtn');
    for (const [iso, offered] of /** @type {[string, boolean][]} */ ([['2026-12-19', true], ['2026-12-20', false], ['2026-12-26', true]])) {
        const day = page.locator(`.calendar-day[data-detail-iso="${iso}"]`);
        await expect(day, `premise: ${iso} is worked with times`).toHaveAttribute('data-detail-worked-times', '08:00-16:00');
        await day.click();
        await expect(page.locator('#dayDetailLightbox')).toHaveClass(/\bopen\b/);
        if (offered) await expect(btn, `${iso} offered no button`).toBeVisible();
        else await expect(btn, `${iso}, after the third week, offered "Who’s on with me"`).toBeHidden();
        await page.locator('#dayDetailClose').click();
        await expect(page.locator('#dayDetailLightbox')).not.toHaveClass(/\bopen\b/);
    }
});
