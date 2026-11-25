/**
 * calendar-swipe-redraw.spec.js — the Calendar (index.html): the month swipe and the redraw — a read
 * or a name change held by a gesture, and keyboard focus kept across a grid rebuilt under it.
 *
 * Split by feature out of calendar.spec.js on 25 Nov 2026, test for test and unchanged; what more than
 * one calendar-*.spec.js file needs is in calendar-helpers.js. Every file keeps the old file's
 * `beforeEach`, so each test still starts signed in as a member. The Calendar's access gate is
 * calendar-access.spec.js.
 */
import { test, expect } from './fixtures.js';
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

// Swipe helper — a real pointer drag across the grid. Left drag = next month, right = previous.
//
// It RETRIES until the month heading actually changes, and that is not defensive padding: a
// mouse-simulated gesture is swallowed perhaps one time in two, and which one moves with the settle
// delay. A fixed `waitForTimeout` therefore produces a test that fails on a different line each run
// and, worse, one that can pass while asserting a state the swipe never reached — which is exactly
// how the first version of this test passed against the bug it was written for.
async function swipeMonth(page, dir) {
    // `.first()`, because the carousel legitimately holds MORE THAN ONE month panel while a swipe
    // is in flight — that is what a carousel is. An unscoped `.month-year` is a strict-mode
    // violation the moment this helper is called during a transition, which under load is exactly
    // when it is called: the previous swipe's panels had not been torn down yet (v21.88).
    //
    // The retry loop below already tolerates a swallowed gesture; it could not tolerate the
    // locator itself throwing, so the failure surfaced as a hard error rather than a retry.
    //
    // ── THE RETRY USED TO OVER-ADVANCE THE CAROUSEL (v22.48) ──────────────────────────────────
    //
    // The retry budget below was 2000ms, and a real transition takes LONGER than that on a loaded
    // machine. So the helper called a gesture that was working "swallowed", swiped again, and moved
    // TWO months in one call. The test then swiped back one and landed a month further out than it
    // meant to — outside the boot window, where the grid is deliberately withheld — and failed on a
    // missing `.calendar-day` while the page sat on a spinner.
    //
    // MEASURED, not reasoned about. A heading-change recorder over 20 runs at `--workers=6`:
    //
    //     55994  [October|September|November]   transition starts
    //     59433  [November] days=0              settles — 3.4s, well past the 2000ms budget
    //     60805  == swipe 2 RETRY               helper gives up and swipes again
    //     64407  == swipe 2 returned            now on December, two months from where it began
    //
    // It surfaced on CI first: one WebKit shard, failing twice including the retry, and passing on
    // the identical commit ten minutes later. A loaded runner is simply another way to make the
    // transition outlast the budget.
    //
    // The budget is now 10s, and the asymmetry is the point: too SHORT silently corrupts the
    // navigation and fails somewhere else entirely, while too LONG only costs time on a gesture
    // that genuinely was swallowed — which is rare. Err long.
    //
    // `before` is also read from a SETTLED carousel now. Read mid-flight it can catch the outgoing
    // panel, which makes the exit condition satisfiable by a transition that was already running.
    // That was not the cause here (fixing it alone changed nothing — 4 failures in 30), but it is a
    // second way for this helper to answer about the wrong month, and it costs one wait.
    await page.waitForFunction(() => document.querySelectorAll('.month-year').length === 1,
        null, { timeout: 10000 });
    const before = await page.locator('.month-year').first().textContent();
    for (let attempt = 0; attempt < 4; attempt++) {
        const box = await page.locator('#calendarDisplay').boundingBox();
        const y = box.y + box.height / 2;
        const [from, to] = dir === 'next'
            ? [box.x + box.width - 20, box.x + 20]
            : [box.x + 20, box.x + box.width - 20];
        await page.mouse.move(from, y);
        await page.mouse.down();
        await page.mouse.move(to, y, { steps: 12 });
        await page.mouse.up();
        try {
            await page.waitForFunction(
                // querySelector already takes the first, so this matches the read above — and it
                // waits for the carousel to settle to ONE panel, so the next call starts clean.
                (b) => document.querySelectorAll('.month-year').length === 1
                    && document.querySelector('.month-year')?.textContent !== b,
                before, { timeout: 10000 });
            return;
        } catch { /* genuinely swallowed — nothing moved in ten seconds — try again */ }
    }
    throw new Error(`swipe ${dir} never committed (still on ${before})`);
}

test('calendar: the legend follows the grid across a SWIPE, in both directions', async ({ page }) => {
    // The regression this pins (v20.41). A swipe COMMIT calls updateLegend() but never
    // renderCalendar() — the incoming carousel panel simply becomes the live view — so a legend
    // decision made in renderCalendar was skipped on the navigation people use most.
    //
    // Getting teeth into this needs a swipe where the right answer CHANGES. The boot fetch covers
    // previous/current/next, so one swipe lands on a month that is already known and the legend is
    // correct either way — a first attempt at this test asserted exactly that and passed against the
    // bug. Two swipes reach OUTSIDE the boot window, and delaying reads only AFTER boot leaves that
    // month genuinely unknown while the months behind it stay good.
    await seedMember(page);
    await page.goto('/');
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    await expect(page.locator('.legend')).toBeVisible();

    // From here on, any NEW month's read hangs. The boot window is already loaded.
    await page.evaluate(() => { (window.__E2E = window.__E2E || {}).docsDelayMs = 30000; });

    await swipeMonth(page, 'next');   // still inside the boot window — known
    await swipeMonth(page, 'next');   // outside it — unknown, so the grid is withheld

    await expect(page.locator('.calendar-pending')).toBeVisible();
    await expect(page.locator('.legend')).toBeHidden();

    // And back: a swipe onto a month that IS known must bring the legend with it. This is the
    // direction a member would report — a perfectly good grid with no colour key.
    await swipeMonth(page, 'prev');
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    await expect(page.locator('.legend')).toBeVisible();
});

// A SWIPE IS SPOKEN AS THE BUTTONS ARE (18 Nov 2026). Prev, Next, Today, the keys and the month picker
// all say the new month in #ariaAnnouncer (the `aria-live` decision, .claude/rules/calendar.md); the
// swipe, the gesture people use most, changed the month in silence.
test('calendar: a swipe to a new month is announced, as Prev and Next are', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-09-16T09:00:00Z'));
    await seedMember(page);
    await page.goto('/');
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    expect(await page.locator('#ariaAnnouncer').textContent(), 'premise: nothing has been announced yet').toBe('');
    await swipeMonth(page, 'next');
    await expect.poll(() => page.locator('#ariaAnnouncer').textContent(), { message: 'the swipe changed the month in silence' })
        .toBe('October 2026');
});

// ── A READ TEAM VIEW STARTED, LANDING DURING A SWIPE ONTO ITS MONTH (10 Nov 2026, cal-ui-5) ─────────
// The incoming month is built at pointerdown as "Checking this month". When its read — started by Team
// View, then left — landed mid-gesture, its only waiter was Team View's repaint, which does nothing once
// Team View is closed, and the commit found the month settled and asked for nothing: the live month sat
// on the wait panel although it had been read. Every waiter must repaint whatever surface is live.
test('calendar: a month read by Team View that lands mid-swipe is drawn when the swipe commits', async ({ page }, info) => {
    test.skip(isTouchProject(info), 'a mouse drag drives the gesture here');
    await page.clock.setFixedTime(new Date('2026-09-16T09:00:00Z'));   // first read: Aug–Oct
    await seedMember(page);
    await page.goto('/');
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    await page.locator('#nextMonth').click();
    await expect(page.locator('.month-year')).toHaveText('October 2026');
    await page.evaluate(() => { (/** @type {any} */ (window).__E2E ??= {}).docsHeld = true; });
    await page.locator('#teamViewBtn').click();                       // opens on 27 Sep – 3 Oct
    for (let i = 0; i < 5; i++) await page.locator('#tvNextWeek').click();
    await expect(page.locator('#tvWeekJump')).toHaveText('1–7 Nov 2026');
    await expect(page.locator('.tv-pending'), 'premise: November is being read, for Team View').toBeVisible();
    await page.locator('#teamViewBtn').click();                       // back to October
    await expect(page.locator('.month-year')).toHaveText('October 2026');

    const live = '#calendarDisplay > .calendar-container:not(.carousel-panel)';
    for (let attempt = 0; ; attempt++) {
        expect(attempt, 'the drag never took hold in four attempts').toBeLessThan(4);
        const box = /** @type {any} */ (await page.locator('#calendarDisplay').boundingBox());
        const y = box.y + box.height / 2;
        await page.mouse.move(box.x + box.width - 20, y);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width - 90, y, { steps: 6 });
        const dragging = await page.waitForFunction((sel) => /translate3d\(-/.test(
            /** @type {HTMLElement|null} */ (document.querySelector(sel))?.style.transform || ''), live, { timeout: 2000 })
            .then(() => true, () => false);
        if (!dragging) { await page.mouse.up(); continue; }
        await expect(page.locator('#calendarDisplay > .carousel-panel').last(), 'premise: November built while unread')
            .toHaveAttribute('data-override-state', 'loading');
        // The read lands NOW, mid-gesture.
        await page.evaluate(() => { /** @type {any} */ (window).__E2E.docsHeld = false; });
        await expect.poll(() => page.evaluate(() => {
            const e = /** @type {any} */ (window).__E2E; return (e.docReadsSettled || 0) >= (e.docReads || 0);
        })).toBe(true);
        await page.mouse.move(box.x + 20, y, { steps: 6 });
        await page.mouse.up();
        break;
    }
    await page.waitForFunction(() => document.querySelectorAll('.month-year').length === 1
        && document.querySelector('.month-year')?.textContent === 'November 2026', null, { timeout: 10000 });
    await expect(page.locator(live), 'the month that was read is drawn, not left waiting')
        .toHaveAttribute('data-override-state', 'render');
});

// ── THE ONE WAIT FOR A SWIPE (Calendar step 3, v25.75 — calendar-redraw.js) ─────────────────────────
// A draw replaces `#calendarDisplay`, and the swipe's three panels live in it. So a BACKGROUND draw — a
// read landing, a name picked in the sheet — waits for the whole gesture, and since v25.75 both wait in
// ONE queue. The rules are unit-tested in calendar-redraw.test.mjs against a clock the test owns; what
// only a browser answers is the wiring: that the page really asks the swipe, really holds, and really
// settles. The gesture is a synthetic touch `pointerdown` that never moves — the pre-intent dead zone,
// the part of a gesture with no cooldown to hide behind, and the part the v16.23 fix first missed.
const LIVE_MONTH = '#calendarDisplay > .calendar-container:not(.carousel-panel)';
const PARKED = '#calendarDisplay > .carousel-panel';
/** @param {import('@playwright/test').Page} page @param {'pointerdown'|'pointercancel'} type */
const touchGrid = (page, type) => page.evaluate((t) => {
    const el = /** @type {HTMLElement} */ (document.getElementById('calendarDisplay'));
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new PointerEvent(t, { pointerType: 'touch', isPrimary: true, bubbles: true,
        clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
}, type);
/** Put the Calendar on a month whose read is out and HELD, so the spec decides when it lands. */
async function openMonthStillBeingRead(/** @type {import('@playwright/test').Page} */ page) {
    await page.clock.setFixedTime(new Date('2026-09-16T09:00:00Z'));   // first read: Aug–Oct
    await seedMember(page);
    await page.goto('/');
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    await page.evaluate(() => { (/** @type {any} */ (window).__E2E ??= {}).docsHeld = true; });
    await page.locator('#nextMonth').click();
    await page.locator('#nextMonth').click();                          // November: outside the first read
    await expect(page.locator(LIVE_MONTH)).toHaveAttribute('data-override-state', 'loading');
}
/** Let the held read land, and wait until the page has been told. */
async function landTheRead(/** @type {import('@playwright/test').Page} */ page) {
    await page.evaluate(() => { /** @type {any} */ (window).__E2E.docsHeld = false; });
    await expect.poll(() => page.evaluate(() => {
        const e = /** @type {any} */ (window).__E2E; return (e.docReadsSettled || 0) >= (e.docReads || 0);
    })).toBe(true);
}
/** Pick a different name in the picker, the way the sheet does. @returns {Promise<string>} the name picked */
const pickAnotherName = (/** @type {import('@playwright/test').Page} */ page) => page.evaluate(() => {
    const sel = /** @type {HTMLSelectElement} */ (document.getElementById('teamMemberSelect'));
    const other = /** @type {HTMLOptionElement} */ ([...sel.options].find(o => o.value !== '' && o.value !== sel.value));
    sel.value = other.value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return /** @type {string} */ (other.textContent);
});

test('redraw: a month read that lands under a resting finger is drawn only when the finger lifts', async ({ page }) => {
    await openMonthStillBeingRead(page);
    await touchGrid(page, 'pointerdown');
    const parked = await page.locator(PARKED).count();
    expect(parked, 'premise: the gesture began — the neighbouring months are parked').toBeGreaterThan(0);

    await landTheRead(page);
    await page.waitForTimeout(300);                                    // five polls of the wait
    await expect(page.locator(LIVE_MONTH), 'the month was drawn under the finger')
        .toHaveAttribute('data-override-state', 'loading');
    expect(await page.locator(PARKED).count(), 'a draw wiped the panels the swipe is about to animate (v16.23)').toBe(parked);

    await touchGrid(page, 'pointercancel');
    await expect(page.locator(LIVE_MONTH), 'and it IS drawn once the finger has gone')
        .toHaveAttribute('data-override-state', 'render');
});

test('redraw: a name picked while a finger rests on the grid is applied when it lifts — not under it, and not dropped', async ({ page }) => {
    await seedMember(page);
    await page.goto('/');
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    const header = page.locator('.header');
    const before = await header.getAttribute('data-member-name');

    await touchGrid(page, 'pointerdown');
    const parked = await page.locator(PARKED).count();
    expect(parked, 'premise: the gesture began').toBeGreaterThan(0);

    const picked = await pickAnotherName(page);
    expect(picked, 'premise: a different name').not.toBe(before);
    await page.waitForTimeout(300);
    expect(await header.getAttribute('data-member-name'), 'the new name was drawn under the finger').toBe(before);
    expect(await page.locator(PARKED).count(), 'a draw wiped the panels the swipe is about to animate').toBe(parked);

    await touchGrid(page, 'pointercancel');
    await expect(header, 'a change that is held is never dropped (v16.19)').toHaveAttribute('data-member-name', picked);
    await expect(page.locator('.calendar-day').first()).toBeVisible();
});

// The one behaviour v25.75 CHANGED. With a timer each (60ms for the name, 120ms for the repaint) the
// page drew twice when the finger lifted: the new name's month, then the same month again.
test('redraw: a read and a name change held by one gesture are ONE draw when it ends', async ({ page }) => {
    await openMonthStillBeingRead(page);
    await touchGrid(page, 'pointerdown');
    await landTheRead(page);                                           // held: a repaint
    const picked = await pickAnotherName(page);                        // held: a change of name

    await page.evaluate(() => {
        const w = /** @type {any} */ (window);
        w.__gridsDrawn = 0;
        new MutationObserver((records) => {
            for (const r of records) for (const n of r.addedNodes) {
                if (n instanceof HTMLElement && n.matches('.calendar-container:not(.carousel-panel)')) w.__gridsDrawn++;
            }
        }).observe(/** @type {HTMLElement} */ (document.getElementById('calendarDisplay')), { childList: true });
    });
    await touchGrid(page, 'pointercancel');
    await expect(page.locator('.header')).toHaveAttribute('data-member-name', picked);
    await expect(page.locator(LIVE_MONTH)).toHaveAttribute('data-override-state', 'render');
    await page.waitForTimeout(400);                                    // long enough for a second timer to have fired
    expect(await page.evaluate(() => /** @type {any} */ (window).__gridsDrawn),
        'the new name\'s month, drawn once — not once per thing that was waiting').toBe(1);
});

// The leave panel's figures are one member's. No tap can change the name while the panel is open — it
// is modal — so this drives the picker directly. What it pins is the scheduler's LAST step, which the
// page hands it as `nameApplied` and which runs after the new name has been drawn.
test('redraw: a change of name closes the leave panel — its figures would be the previous name\'s', async ({ page }) => {
    await seedMember(page);
    await page.goto('/');
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    await page.locator('#alBtn').click();
    await expect(page.locator('#alLightbox')).toBeVisible();
    const picked = await pickAnotherName(page);
    await expect(page.locator('#alLightbox')).toBeHidden();
    await expect(page.locator('.header')).toHaveAttribute('data-member-name', picked);
});
// Retired, the hint fades and is then hidden, and the wait before hiding it is the fade's own length, read off the
// stylesheet: calendar-app.js kept a second copy of the number (400ms, against --dur-slower's 0.3s), and two homes for
// one figure drift apart. A fade made longer here must run to its end before the line goes.
test('calendar: the swipe hint is hidden when its fade has run, however long the stylesheet makes it', async ({ page }, info) => {
    test.skip(!isTouchProject(info), 'the hint is touch-only');
    await seedMemberSession(page, 'G. Miller');
    await page.goto('/');
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    const hint = page.locator('#swipeHint');
    await expect(hint, 'premise: a first visit shows the hint').toBeVisible();
    await page.addStyleTag({ content: '.swipe-hint { transition: opacity 2s linear !important; }' });
    await page.locator('#nextMonth').click();
    await expect(hint).toHaveClass(/fade-out/);
    await page.waitForTimeout(1000);
    expect(await hint.evaluate(el => /** @type {HTMLElement} */ (el).style.display), 'hidden halfway through its fade').not.toBe('none');
    await expect(hint, 'and hidden once it has run').toBeHidden({ timeout: 5000 });
    expect(await page.evaluate(() => localStorage.getItem('myb_swipe_hint_seen'))).toBe('1');
});

// ── KEYBOARD FOCUS SURVIVES A GRID REBUILT UNDER IT (10 Nov 2026, cal-ui-4) ─────────────────────────
// Every re-render wipes #calendarDisplay. With focus dropped to <body>, PageUp/PageDown do nothing and
// ← → change the MONTH instead of the day, so each of these left a keyboard user stranded.
/** Which day cell holds focus, by its date words — or what does, when no day cell does. */
const focusedDay = (/** @type {import('@playwright/test').Page} */ page) => page.evaluate(() => {
    const a = /** @type {HTMLElement|null} */ (document.activeElement);
    return a?.classList.contains('calendar-day') && a.closest('#calendarDisplay') ? a.dataset.detailDay : `not a day: ${a?.tagName}`;
});

test('calendar: PageDown onto a month still loading keeps focus for the grid that follows', async ({ page }, info) => {
    test.skip(isTouchProject(info), 'the keyboard route');
    await page.clock.setFixedTime(new Date('2026-09-16T09:00:00Z'));
    await seedMember(page);
    await page.goto('/');
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    await page.evaluate(() => { (/** @type {any} */ (window).__E2E ??= {}).docsHeld = true; });   // new months wait
    await page.locator('.calendar-day.today').focus();
    await page.keyboard.press('PageDown');   // October: inside the first read, drawn at once
    await expect(page.locator('.month-year')).toHaveText('October 2026');
    await page.keyboard.press('PageDown');   // November: not read yet
    await expect(page.locator('.calendar-pending')).toBeVisible();
    await page.evaluate(() => { (/** @type {any} */ (window).__E2E ??= {}).docsHeld = false; });
    await expect(page.locator('#calendarDisplay .calendar-day').first()).toBeVisible();
    expect(await focusedDay(page), 'the grid that arrived must take the focus back').toMatch(/November 2026$/);
    await page.keyboard.press('PageDown');
    await expect(page.locator('.month-year'), 'and PageDown still pages').toHaveText('December 2026');
});

// The other half of the same rule (calendar-redraw.js → `focusWanted`): the focus is owed to the grid
// only while it is still NOWHERE. A reader who tabbed to a control while the month loaded is not
// pulled back into the grid when it arrives.
test('redraw: focus moved to a control while a month loads stays there when the grid arrives', async ({ page }, info) => {
    test.skip(isTouchProject(info), 'the keyboard route');
    await page.clock.setFixedTime(new Date('2026-09-16T09:00:00Z'));
    await seedMember(page);
    await page.goto('/');
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    await page.evaluate(() => { (/** @type {any} */ (window).__E2E ??= {}).docsHeld = true; });
    await page.locator('.calendar-day.today').focus();
    await page.keyboard.press('PageDown');   // October
    await expect(page.locator('.month-year')).toHaveText('October 2026');
    await page.keyboard.press('PageDown');   // November: not read yet — the focus is now owed
    await expect(page.locator('.calendar-pending')).toBeVisible();
    await page.locator('#prevMonth').focus();
    await page.evaluate(() => { /** @type {any} */ (window).__E2E.docsHeld = false; });
    await expect(page.locator('#calendarDisplay .calendar-day').first()).toBeVisible();
    expect(await page.evaluate(() => document.activeElement?.id), 'the grid took focus from the control the reader chose')
        .toBe('prevMonth');
});

test('calendar: closing the day panel after the grid was redrawn behind it returns focus to that day', async ({ page }, info) => {
    test.skip(isTouchProject(info), 'the keyboard route');
    await page.clock.setFixedTime(new Date('2026-09-16T09:00:00Z'));
    await seedMember(page);
    await page.addInitScript(() => {
        const w = /** @type {any} */ (window); w.__E2E = w.__E2E || {};
        // The month is painted from the cache while the first server read is held open.
        w.__E2E.cacheDocs = w.__E2E.docs = [{ id: 'c1', memberName: 'G. Miller', date: '2026-09-18', type: 'annual_leave', value: 'AL', note: '' }];
        w.__E2E.docsHeld = true;
    });
    await page.goto('/');
    const shown = page.locator('#calendarDisplay > .calendar-container');
    await expect(shown).toHaveAttribute('data-override-state', 'stale');
    const cell = page.locator('#calendarDisplay .calendar-day:not(.other-month):not(.payday):not(.cutoff)').nth(9);
    const day = await cell.getAttribute('data-detail-day');
    await cell.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#dayDetailLightbox')).toBeVisible();
    await page.evaluate(() => { /** @type {any} */ (window).__E2E.docsHeld = false; });   // the read lands
    await expect(shown, 'premise: the grid behind the panel was rebuilt').toHaveAttribute('data-override-state', 'render');
    await page.keyboard.press('Escape');
    await expect(page.locator('#dayDetailLightbox')).toBeHidden();
    expect(await focusedDay(page)).toBe(day);
});

test('calendar: T in Team View keeps focus on the control it was pressed from', async ({ page }, info) => {
    test.skip(isTouchProject(info), 'the keyboard route');
    await page.clock.setFixedTime(new Date('2026-09-16T09:00:00Z'));
    await seedMember(page);
    await page.goto('/');
    await page.locator('#teamViewBtn').click();
    await page.locator('#tvNextWeek').click();   // a week away, so T has somewhere to go
    await expect(page.locator('#tvNextWeek')).toBeFocused();
    await page.keyboard.press('t');
    await expect(page.locator('.tv-week-status--now'), 'premise: back on this week').toBeVisible();
    await expect(page.locator('#tvNextWeek'), 'the rebuilt Next still has the focus').toBeFocused();
    // "↩ Back to this week" is not drawn on this week, so focus moves to Next, as its own click does.
    await page.locator('#tvNextWeek').click();
    await page.locator('#tvToday').focus();
    await page.keyboard.press('t');
    await expect(page.locator('#tvNextWeek')).toBeFocused();
});

// A MOUSE CAN DO SOMETHING A FINGER CANNOT: DRAG — and from v23.59 a click opens the day panel on
// every pointer type, so "does a paging drag also open a panel?" is a question the change raises and
// nothing else answers. It does not, and THE REASON IS THE PLATFORM'S, not ours: the swipe takes
// `setPointerCapture` on the first `pointermove`, and both engines then dispatch the compatibility
// `click` at the capture element — measured, `#calendarDisplay`, never a `.calendar-day`. A tap sets
// no capture at all (calendar-swipe.js deliberately captures on MOVE, not on `pointerdown`, because
// iOS suppresses `pointermove` if it is captured there) and lands on the cell as it always did.
//
// SO THIS TEST HAS NO TEETH AGAINST OUR OWN CODE, and saying so is better than implying otherwise: a
// guard was written first, in the coordinator, and deleting it changed nothing on either engine —
// which is why there is no guard in the tree to find. What it pins is the PLATFORM ASSUMPTION the
// absence of one rests on. If a future engine stops retargeting, or the capture moves back to
// `pointerdown`, this is what fails, and the coordinator gets its guard then.
test('calendar: a mouse drag pages the month and does NOT open the day panel', async ({ page }, info) => {
    test.skip(isTouchProject(info), 'the defect is a mouse drag; a touch pan fires no click');
    await seedMemberSession(page, 'G. Miller');
    await page.goto('/');
    await expect(page.locator('.calendar-day').first()).toBeVisible();

    // Retried for the same reason `swipeMonth` retries — a mouse-simulated gesture is swallowed
    // perhaps one time in two. A SWALLOWED one legitimately opens the panel (a drag that pages
    // nothing is a click), so it is closed and the attempt repeated rather than asserted on.
    for (let attempt = 0; attempt < 4; attempt++) {
        await page.waitForFunction(() => document.querySelectorAll('.month-year').length === 1,
            null, { timeout: 10000 });
        const before = await page.locator('.month-year').first().textContent();
        const box = /** @type {any} */ (await page.locator('.calendar-day:not(.other-month)').nth(15).boundingBox());
        expect(box.width, 'the drag must fit inside ONE cell or the click never reaches a day')
            .toBeGreaterThan(95);
        const y = box.y + box.height / 2;
        await page.mouse.move(box.x + box.width - 5, y);
        await page.mouse.down();
        await page.mouse.move(box.x + 5, y, { steps: 12 });
        await page.mouse.up();

        let paged = true;
        try {
            await page.waitForFunction((b) => document.querySelectorAll('.month-year').length === 1
                && document.querySelector('.month-year')?.textContent !== b, before, { timeout: 10000 });
        } catch { paged = false; }

        if (paged) {
            await expect(page.locator('#dayDetailLightbox'), 'a paging drag must not open a day panel')
                .toBeHidden();
            return;
        }
        if (await page.locator('#dayDetailLightbox').isVisible()) await page.locator('#dayDetailClose').click();
    }
    throw new Error('the drag never paged the month in four attempts');
});

// THE HOVER TOOLTIP AND THE PANEL, WHICH NOW SHARE A POINTER (v23.59). Before this release they
// could not meet: the tooltip was the desktop route to a day and the panel the touch one. A click
// now opens the panel WITHOUT MOVING THE MOUSE, so `mousemove` never re-runs — which raises the
// question of whether the tip strands over the backdrop, describing in one line the day the panel
// is describing in full.
//
// IT DOES NOT, AND NOT BECAUSE OF THE CSS THAT LOOKS LIKE THE ANSWER. Deleting
// `body.lb-open #calTooltip { display: none }` and re-running this leaves it GREEN on both engines:
// the full-screen overlay appearing under a stationary cursor fires a `mouseover`, the handler
// resolves no cell and hides the tip itself. The CSS is kept as belt and braces (index.css says
// why) and this test is what actually holds the behaviour.
//
// THE SECOND HALF IS THE ONE WITH TEETH: a tooltip hidden and never given back would be SILENT. It
// is drawn only under a live pointer, so it appears in no visual baseline, axe has no rule for it,
// and until v23.59 nothing in this repo had ever asserted on it at all.
test('calendar: the hover tooltip yields to the day panel — and comes back afterwards', async ({ page }, info) => {
    test.skip(isTouchProject(info), 'there is no hover on a touch device; the tip is never built');
    await seedMemberSession(page, 'G. Miller');
    await page.goto('/');
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    const tip = page.locator('#calTooltip');
    const cellA = page.locator('.calendar-day:not(.other-month)').nth(10);
    const cellB = page.locator('.calendar-day:not(.other-month)').nth(14);

    await cellA.hover();
    await expect(tip, 'the tooltip is still the hover preview').toBeVisible();

    await cellA.click();
    await expect(page.locator('#dayDetailLightbox')).toBeVisible();
    await expect(tip, 'and it must not sit over the panel it duplicates').toBeHidden();
    // Moving over the BACKDROP keeps it down — the handler resolves no cell there, which is the
    // pre-existing path; the CSS covers the case where the pointer never moves at all.
    await page.mouse.move(8, 8);
    await expect(tip).toBeHidden();

    await page.locator('#dayDetailClose').click();
    await expect(page.locator('#dayDetailLightbox')).toBeHidden();
    await cellB.hover();
    await expect(tip, 'a panel must not kill the tooltip for the rest of the session').toBeVisible();
});
