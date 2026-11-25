/**
 * calendar-loading.spec.js — the Calendar (index.html): loading a month — the grid withheld until its
 * records are known, the retry, the sync chip, the saved copy and the month kept across a reload.
 *
 * Split by feature out of calendar.spec.js on 25 Nov 2026, test for test and unchanged; what more than
 * one calendar-*.spec.js file needs is in calendar-helpers.js. Every file keeps the old file's
 * `beforeEach`, so each test still starts signed in as a member. The Calendar's access gate is
 * calendar-access.spec.js.
 */
import { test, expect } from './fixtures.js';
import { collectFatalErrors, seedSession, seedMember, seedCalendarMember, seedMemberSession } from './helpers.js';

// ── Calendar access ─────────────────────────────────────────────────────────────────────────────
// The Calendar opens only for a signed-in member (since the staff PIN was retired, 23 Nov 2026; from
// v20.12 the PIN opened it too), so a spec that simply loads index.html gets the sign-in card and none
// of the roster. Every test in this file is about what the Calendar DOES once it is open, not about
// the gate, so each page starts signed in as a member with no calendar picked on this device
// (`seedCalendarMember`) — the member's own calendar. Until the PIN went it started on a PIN viewer,
// whose `getSession()` was null; the tests that existed only for that state (the first-run prompt,
// the station PC's Team View and bug report) went with it. The gate itself is calendar-access.spec.js.
test.beforeEach(async ({ page }) => { await seedCalendarMember(page); });


// ── CALENDAR (index.html) ──────────────────────────────────────────────────

test('calendar: renders the current month from roster data', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await seedMember(page);   // saved member → render the grid, not the first-run prompt (H1)
    await page.goto('/');

    // .month-year is built entirely by JS — if this is visible, the whole
    // roster-data → buildCalendarContainer → renderCalendar pipeline ran.
    await expect(page.locator('.month-year')).toBeVisible();

    // At least one day cell must exist (the calendar grid rendered)
    await expect(page.locator('.calendar-day').first()).toBeVisible();

    expect(errors, 'Uncaught JS exceptions on index.html').toHaveLength(0);
});

// ── The grid is withheld until the overrides are known (v20.40) ──────────────────────────────────
//
// The unit tests prove the DECISION; only a browser proves the WIRING — that a real page open with a
// slow or failed Firestore read actually withholds, rather than the fetch module recording a state
// nobody reads. The bug being guarded is precisely one nothing threw on: the base roster is drawn
// perfectly, and it is somebody else's day.

test('calendar: a month whose overrides have not arrived shows NO shifts', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await seedMember(page);
    // Hold every collection read open. This is the fresh-browser case: no local cache to paint from,
    // so before v20.40 the base roster went straight up while the read was still in flight.
    await page.addInitScript(() => { (window.__E2E = window.__E2E || {}).docsDelayMs = 30000; });
    await page.goto('/');

    await expect(page.locator('.calendar-pending')).toBeVisible();
    await expect(page.locator('.calendar-day')).toHaveCount(0);
    // The month label survives — the header is kept in every state so the sync chip has a mount point.
    await expect(page.locator('.month-year')).toBeVisible();
    // And the legend goes with the grid: it is a key to cells that are not there, derived from the
    // base roster, so leaving it up would announce this month's shift types while the panel beside it
    // says we do not know them.
    await expect(page.locator('.legend')).toBeHidden();
    expect(errors, 'Uncaught JS exceptions on index.html').toHaveLength(0);
});

test('calendar: a FAILED override read offers a retry, and still shows no shifts', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await seedMember(page);
    await page.addInitScript(() => { (window.__E2E = window.__E2E || {}).failGetDocs = true; });
    await page.goto('/');

    // The failed panel is a different panel from the wait one — it names the failure and carries the
    // action. A single "loading" state for both would leave a member waiting on something that has
    // already lost, which is the shape the old code had (base roster + a chip, indefinitely).
    await expect(page.locator('.calendar-pending--failed')).toBeVisible();
    await expect(page.locator('.calendar-pending-retry')).toBeVisible();
    await expect(page.locator('.calendar-day')).toHaveCount(0);
    expect(errors, 'Uncaught JS exceptions on index.html').toHaveLength(0);
});

test('calendar: the retry re-reads, and a grid appears when it succeeds', async ({ page }) => {
    await seedMember(page);
    await page.addInitScript(() => { (window.__E2E = window.__E2E || {}).failGetDocs = true; });
    await page.goto('/');
    await expect(page.locator('.calendar-pending-retry')).toBeVisible();

    // Let the next read succeed, then press the button the panel offered.
    await page.evaluate(() => { window.__E2E.failGetDocs = false; });
    await page.locator('.calendar-pending-retry').click();

    await expect(page.locator('.calendar-day').first()).toBeVisible();
    await expect(page.locator('.calendar-pending')).toHaveCount(0);
    await expect(page.locator('.legend')).toBeVisible();
});

// A retry that WORKED must not leave the header saying it failed (48-hour review). The initial sync's
// failure is recorded as a chip state that re-attaches whenever the header is rebuilt; the panel's own
// Try again re-reads the month without passing through the chip, so the grid came back with
// "Couldn't update — try again" above it, contradicting the shifts it was showing.
test('calendar: after the panel retry succeeds, no "couldn\'t update" chip is left behind', async ({ page }) => {
    await seedMember(page);
    await page.addInitScript(() => { (window.__E2E = window.__E2E || {}).failGetDocs = true; });
    await page.goto('/');
    await expect(page.locator('.calendar-pending-retry')).toBeVisible();
    await expect(page.locator('.sync-chip.sync-chip-error')).toHaveCount(1);   // the failure WAS recorded

    await page.evaluate(() => { window.__E2E.failGetDocs = false; });
    await page.locator('.calendar-pending-retry').click();

    await expect(page.locator('.calendar-day').first()).toBeVisible();
    await expect(page.locator('.sync-chip-error')).toHaveCount(0);
});

// ONE MESSAGE AT A TIME (polish round 2). The withheld-grid panel and the header sync chip used to say
// the same thing together — "Checking this month" beside "Updating shifts…", "Couldn't check
// this month" + Try again beside "Couldn't update — try again". The chip now steps back while a
// panel speaks, and ONLY then: over a painted grid it is the only thing saying a sync is running.
//
// Each case asserts the chip EXISTS before asserting it is hidden — `toBeHidden` alone also passes
// on a chip that was never created, which would hold whether or not the rule in index.css exists.
test('calendar: while the grid panel speaks, the header sync chip does not repeat it', async ({ page }) => {
    await seedMember(page);
    await page.addInitScript(() => { (window.__E2E = window.__E2E || {}).docsDelayMs = 30000; });
    await page.goto('/');
    await expect(page.locator('.calendar-pending')).toBeVisible();
    const chip = page.locator('.sync-chip');
    await expect(chip).toHaveCount(1);            // created at 800ms — it is there, just not shown
    await expect(chip).toBeHidden();
    await expect(page.locator('.calendar-pending')).toBeVisible();
});

test('calendar: a FAILED panel with its own Try again is not echoed by a retry chip', async ({ page }) => {
    await seedMember(page);
    await page.addInitScript(() => { (window.__E2E = window.__E2E || {}).failGetDocs = true; });
    await page.goto('/');
    await expect(page.locator('.calendar-pending-retry')).toBeVisible();
    const chip = page.locator('.sync-chip');
    await expect(chip).toHaveCount(1);
    await expect(chip).toHaveClass(/sync-chip-error/);
    await expect(chip).toBeHidden();
});

test('calendar: over a PAINTED grid the sync chip still shows — it is the only signal there', async ({ page }) => {
    await seedMember(page);
    // A cached month paints from phase 1 while the server read hangs: a real grid, a sync still
    // running, and no panel. This is the case the owner asked to keep, and the one a rule written
    // too broadly (hiding every chip) would silently take away.
    await page.addInitScript(() => {
        const d = new Date();
        const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-15`;
        window.__E2E = Object.assign(window.__E2E || {}, {
            docsDelayMs: 30000,
            cacheDocs: [{ id: 'x', memberName: 'G. Miller', date: iso, type: 'rdw', value: '09:00-17:00' }],
        });
    });
    await page.goto('/');
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    await expect(page.locator('.calendar-pending')).toHaveCount(0);
    await expect(page.locator('.sync-chip')).toBeVisible();
});

// Every "today" on the page is read at render time and nothing re-rendered by itself, so a Calendar
// left open over midnight (or a PWA resumed the next morning) highlighted yesterday.
test('calendar: the Today highlight moves when the local date turns', async ({ page }) => {
    await page.clock.install({ time: new Date(2026, 8, 16, 23, 59, 0) });
    await seedMember(page);
    await page.goto('/');
    const today = page.locator('.calendar-day.today');
    await expect(today).toHaveCount(1);
    const before = (await today.textContent())?.trim() ?? '';
    await page.clock.runFor('02:00');   // past local midnight
    await expect(today).toHaveCount(1);
    await expect.poll(async () => (await today.textContent())?.trim()).not.toBe(before);
});

// A month read once used to stay "current" for the life of the page, so a PC or a resumed phone showed
// the morning's roster in the afternoon (Oct 2026 review). Coming back into view after ten minutes
// re-reads; coming back sooner does not. The observable is the read itself.
test('calendar: coming back into view re-reads a month once it is ten minutes old, and not before', async ({ page }) => {
    await page.clock.install({ time: new Date(2026, 9, 2, 9, 0, 0) });
    await seedMember(page);
    await page.goto('/');
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    const reads = () => page.evaluate(() => /** @type {any} */ (window).__E2E?.docReads || 0);
    const comeBack = () => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect.poll(reads).toBeGreaterThan(0);
    await page.clock.runFor('00:05');
    const settled = await reads();
    await comeBack();
    await page.clock.runFor('00:02');
    expect(await reads(), 'a fresh month is not re-read').toBe(settled);
    await page.clock.fastForward('11:00');
    await comeBack();
    await expect.poll(reads, { message: 'a stale month is re-read on return' }).toBeGreaterThan(settled);
});

// "It always reopens on June 2026" (owner, 15 Nov 2026), the month the app was installed: a stored month
// was kept until the member came back to today's month, however long that took, and every launch drew
// it and stored it again. A month browsed to is kept for half an hour now (calendar-state.js,
// BROWSED_MONTH_KEPT_MS), through both ways a phone opens the app again: a RELOAD (the phone closed it
// behind another app) and simply being SHOWN again (it was still in memory). Each gap starts with the page
// put away, as a phone's does: a page left on screen is still being looked at, and its redraws keep the
// month (measured — a visible page's timers redraw it, and each redraw stores the month afresh). Driven
// through the page, so the render that stores the month and the date watcher's repaint are the real ones.
test('calendar: a month browsed to is kept for half an hour — reloaded or brought back — then today\'s month opens', async ({ page }) => {
    await page.clock.install({ time: new Date(2026, 10, 15, 12, 0, 0) });
    await seedMember(page);
    await page.goto('/');
    const heading = page.locator('.month-year');
    const back = async () => { for (let i = 0; i < 5; i++) await page.locator('#prevMonth').click(); };
    /** Put the page away, or bring it back, the way a phone does: the state, then the event. */
    const visibility = (/** @type {'hidden'|'visible'} */ state) => page.evaluate((v) => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v });
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => v === 'hidden' });
        document.dispatchEvent(new Event('visibilitychange'));
    }, state);
    await expect(heading).toHaveText('November 2026');
    await back();
    await expect(heading).toHaveText('June 2026');

    await visibility('hidden');
    await page.clock.fastForward('20:00');
    await page.reload();
    await expect(heading, 'reopened twenty minutes later, the member\'s own month was dropped').toHaveText('June 2026');
    await visibility('hidden');
    await page.clock.fastForward('45:00');
    await page.reload();
    await expect(heading, 'reopened after 45 minutes away, still on June').toHaveText('November 2026');

    // Not reloaded: put away, and shown again.
    await back();
    await expect(heading).toHaveText('June 2026');
    await visibility('hidden');
    await page.clock.fastForward('10:00');
    await visibility('visible');
    await expect(heading, 'ten minutes away took the member off their month').toHaveText('June 2026');
    // What this return tests is the MONTH the date watcher moves to, not which draw shows it: after
    // half an hour the stale-month re-check (calendar-initial-fetch.js, ten minutes) redraws the grid
    // as well, so the watcher's own repaint cannot be told apart here (measured: removing it left this
    // green). That repaint is pinned by "the Today highlight moves when the local date turns", above.
    await visibility('hidden');
    await page.clock.fastForward('31:00');
    await visibility('visible');
    await expect(heading, 'shown again after half an hour away, still on June').toHaveText('November 2026');
});

// …AND A MONTH AHEAD, the same way (owner, 18 Nov 2026). Until then a month ahead of today was never
// restored by a load, so a trip to another page and back through the drawer (a fresh load) put the
// member back on today's month while the same trip with the app kept in memory did not.
test('calendar: a month AHEAD browsed to is kept across a reload for half an hour, then today\'s month opens', async ({ page }) => {
    await page.clock.install({ time: new Date(2026, 10, 15, 12, 0, 0) });
    await seedMember(page);
    await page.goto('/');
    const heading = page.locator('.month-year');
    const hide = () => page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
        document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(heading).toHaveText('November 2026');
    await page.locator('#nextMonth').click();
    await page.locator('#nextMonth').click();
    await expect(heading).toHaveText('January 2027');

    await hide();
    await page.clock.fastForward('20:00');
    await page.reload();
    await expect(heading, 'reloaded twenty minutes later, the month ahead was dropped').toHaveText('January 2027');
    await hide();
    await page.clock.fastForward('45:00');
    await page.reload();
    await expect(heading, 'reloaded after 45 minutes away, still on the month ahead').toHaveText('November 2026');
});

// …AND THE OWNER'S OWN PHONE, as it holds the month today: a June stored in June 2026, when every render
// stored the month on screen, and with no time beside it, because no release before v26.19 wrote one.
// Before this release that June opened on every launch and was stored again; now it opens on today's
// month, whose draw clears the old keys.
test('calendar: a month an older release stored, with no time beside it, opens on today\'s month', async ({ page }) => {
    await page.clock.install({ time: new Date(2026, 10, 15, 12, 0, 0) });
    await seedMember(page);
    await page.addInitScript(() => {
        localStorage.setItem('myb_roster_month', '5');   // June, 0-indexed
        localStorage.setItem('myb_roster_year', '2026');
    });
    await page.goto('/');
    await expect(page.locator('.month-year'), 'the June stored at install opened again').toHaveText('November 2026');
    await expect.poll(() => page.evaluate(() => ['myb_roster_month', 'myb_roster_year', 'myb_roster_month_at']
        .map((k) => localStorage.getItem(k))), { message: 'today\'s month stores nothing' }).toEqual([null, null, null]);
});

// …AND WHEN THAT RE-READ FAILS, THE PAGE SAYS SO (10 Nov 2026, external review F1). A month read in the
// morning and re-checked in the afternoon with no signal went on being drawn as current — "As rostered"
// included — because the failure could not be recorded against a month already known. The grid must
// STAY (a failed re-check never blanks good data), labelled as the saved copy; the claim that nothing
// has changed goes; and the label clears itself on the next return that can check, without a press.
// Both failures a dead signal produces are driven: the read answered by this device's cache, and the
// read rejected outright. One-shot counts of the "As rostered" flag, because an auto-retrying assertion
// would simply wait for a later render.
test('calendar: a re-check that fails on return keeps the grid as a saved copy, and clears when it can check again', async ({ page }) => {
    await page.clock.install({ time: new Date(2026, 9, 2, 9, 0, 0) });
    await seedMember(page);
    await seedMemberSession(page);
    await page.addInitScript(() => {
        const w = /** @type {any} */ (window); w.__E2E = w.__E2E || {};
        w.__E2E.docs = [{ id: 'oct', memberName: 'G. Miller', date: '2026-10-14', type: 'annual_leave', value: 'AL', note: '' }];
    });
    await page.goto('/');
    const shown = page.locator('#calendarDisplay > .calendar-container:not(.carousel-panel)');
    const note  = page.locator('.calendar-stale-note');
    const set   = (/** @type {Record<string, any>} */ flags) => page.evaluate((f) => Object.assign(/** @type {any} */ (window).__E2E, f), flags);
    const comeBack = () => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    const claiming = () => page.evaluate(() => document.querySelectorAll('.calendar-day[data-detail-as-rostered]').length);
    const leaveDay = page.locator('.calendar-day[data-detail-day="Wednesday 14 October 2026"]');

    await expect(shown, 'premise: October is read and current').toHaveAttribute('data-override-state', 'render');
    expect(await claiming(), 'premise: a current month says which days are as rostered').toBeGreaterThan(0);
    await expect(note).toHaveCount(0);
    await page.clock.runFor('00:05');

    // No signal: the re-read is answered by this device's cache.
    await set({ docsFromCache: true });
    await page.clock.fastForward('11:00');
    await comeBack();
    await expect(note, 'the failed re-check must reach the screen').toBeVisible();
    await expect(note).toContainText('Saved copy — couldn’t check for changes');
    await expect(shown).toHaveAttribute('data-override-state', 'stale');
    await expect(page.locator('.calendar-grid'), 'the grid is kept — a failed re-check never blanks good data').toBeVisible();
    await expect(leaveDay, 'with the leave it already held').toContainText('AL');
    expect(await claiming(), '"As rostered" is a claim about a check that worked').toBe(0);

    // The signal is back, and the phone is simply picked up again: no ten minutes, no press.
    await set({ docsFromCache: false });
    await comeBack();
    await expect(note, 'the label clears itself on the next return that can check').toHaveCount(0);
    await expect(shown).toHaveAttribute('data-override-state', 'render');
    expect(await claiming()).toBeGreaterThan(0);

    // The other failure: the read is rejected outright. Still the saved copy, not the failure panel.
    await set({ failGetDocs: true });
    await page.clock.fastForward('11:00');
    await comeBack();
    await expect(note).toBeVisible();
    await expect(page.locator('.calendar-grid')).toBeVisible();
    await expect(page.locator('.calendar-pending'), 'never the failure panel over data in hand').toHaveCount(0);

    // "Try again" pressed while the signal is still down must not cost the member the grid they had:
    // the press forgets the month so that it visibly does something, and the retry then fails too.
    const settled = () => page.evaluate(() => /** @type {any} */ (window).__E2E.docReadsSettled || 0);
    const before = await settled();
    await note.getByRole('button', { name: 'Try again' }).click();
    await expect.poll(settled, { message: 'premise: the retry was made, and it failed' }).toBeGreaterThan(before);
    await expect(note, 'the saved copy comes back').toBeVisible();
    await expect(page.locator('.calendar-grid')).toBeVisible();
    await expect(page.locator('.calendar-pending'), 'still not the failure panel').toHaveCount(0);

    // And once it can check, one press makes the month current again.
    await set({ failGetDocs: false });
    await note.getByRole('button', { name: 'Try again' }).click();
    await expect(note).toHaveCount(0);
    await expect(shown).toHaveAttribute('data-override-state', 'render');
});

// A month read is EVERYONE's overrides, so a member switched while it is in flight is waiting on
// it too. The repaint used to be guarded on the member who started the read, and the second caller
// was dropped on the in-flight claim — so the new member sat on "Checking this month" for good.
test('calendar: switching member while a month is loading still paints it when it lands', async ({ page }) => {
    await seedMember(page);
    await page.goto('/');
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    await page.evaluate(() => { (window.__E2E = window.__E2E || {}).docsDelayMs = 1500; });
    await page.locator('#nextMonth').click();
    await page.locator('#nextMonth').click();   // outside the boot window — its read is now in flight
    await expect(page.locator('.calendar-pending')).toBeVisible();
    await page.evaluate(() => {
        const sel = /** @type {HTMLSelectElement} */ (document.getElementById('teamMemberSelect'));
        const other = [...sel.options].find(o => o.value !== '' && o.value !== sel.value);
        if (other) sel.value = other.value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect(page.locator('.calendar-pending')).toHaveCount(0, { timeout: 8000 });
    await expect(page.locator('.calendar-day').first()).toBeVisible();
});

test('calendar: a successful read renders the grid — the withholding is a gate, not a disablement', async ({ page }) => {
    await seedMember(page);
    await page.goto('/');
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    await expect(page.locator('.calendar-pending')).toHaveCount(0);
});

// ─── A BOOT MAKES ONLY THE MARKS THE APP SPEED CARD READS (App Speed review, Oct 2026) ────────────
//
// The start ladder's rungs (`authBoot`, `access`, `rosterCached`, `rosterLive`) and the boot-phase
// mark were retired with the card blocks that read them. The reporter refuses those ids now, but the
// COORDINATOR makes the calls and no unit suite runs it — a mark left behind would cost every open a
// timing nothing reads. A cache hit, because that boot used to make the most of them.
test('calendar: a boot makes only the performance marks the App Speed card reads', async ({ page }) => {
    await seedSession(page);
    await seedMember(page);
    await page.addInitScript(() => {
        const d = new Date();
        const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-15`;
        window.__E2E = Object.assign(window.__E2E || {}, {
            authUser: true,
            cacheDocs: [{ id: 'x', memberName: 'G. Miller', date: iso, type: 'rdw', value: '09:00-17:00' }],
        });
    });
    await page.goto('/index.html');
    await expect(page.locator('.calendar-day').first()).toBeVisible({ timeout: 20000 });
    await expect.poll(
        () => page.evaluate(() => performance.getEntriesByName('myb-page-ready').length),
        { message: 'the boot must actually have finished before asserting what it marked', timeout: 15000 },
    ).toBeGreaterThan(0);
    // No stored copy was seeded, so the one other mark the card reads (`myb-roster-snapshot`) is
    // absent too — e2e/calendar-access.spec.js pins that it IS made when a copy is painted.
    const marks = await page.evaluate(() => performance.getEntriesByType('mark').map(m => m.name));
    expect(marks.filter(n => n.startsWith('myb-'))).toEqual(['myb-page-ready']);
});

// ── A MONTH ANSWERED FROM THE CACHE, OUTSIDE THE FIRST LOAD (whole-app review, Oct 2026) ─────────
// `stale` is the grid "labelled as possibly out of date, with a retry". The first load's months have
// the sync chip for that; a month reached later had nothing, so a member offline in November read a
// cached grid as current. November is outside the boot window of a 16 Sep clock (Aug–Oct).
// THE FIRST CHECK IS NOT A FAILED ONE (whole-app review, Nov 2026; wiring pinned at the 48-hour review).
// The renderer's `checking` rule is unit-tested; these are the two lines that pass it: renderCalendar
// in calendar-app.js, and the swipe's neighbouring months in calendar-swipe.js, built on pointerdown.
// Without them every cached month opened with "Saved copy — couldn't check for changes" while the
// check it denied was still running. The read is held for the whole test and both checks are ONE-SHOT
// counts: an auto-retrying toHaveCount(0) simply waited for the read to land, and passed with the
// wiring deleted (measured).
test('calendar: a cached month at startup does not claim it could not check, while the first check runs', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-09-16T09:00:00Z'));
    await seedMember(page);
    await seedMemberSession(page);
    await page.addInitScript(() => {
        const w = /** @type {any} */ (window); w.__E2E = w.__E2E || {};
        // One row in each month of the first read (Aug–Oct), so all three are painted from the cache.
        const rows = ['2026-08-12', '2026-09-18', '2026-10-14'].map((date, i) => ({
            id: `c${i}`, memberName: 'G. Miller', date, type: 'annual_leave', value: 'AL', note: '' }));
        w.__E2E.cacheDocs = rows;
        w.__E2E.docs = rows;
        w.__E2E.docsDelayMs = 30000;       // the first server read is still out for the whole test
    });
    await page.goto('/');
    const shown = page.locator('#calendarDisplay > .calendar-container:not(.carousel-panel)');
    await expect(shown, 'premise: September is painted from the cache').toHaveAttribute('data-override-state', 'stale');
    expect(await page.locator('.calendar-stale-note').count(), 'renderCalendar passes `checking`').toBe(0);

    await page.locator('#calendarDisplay .calendar-day').nth(10).hover();
    await page.mouse.down();
    const panels = page.locator('#calendarDisplay > .carousel-panel');
    await expect(panels).toHaveCount(2);
    await expect(panels.first(), 'premise: the neighbours are cached months too').toHaveAttribute('data-override-state', 'stale');
    await expect(panels.last()).toHaveAttribute('data-override-state', 'stale');
    expect(await page.locator('.calendar-stale-note').count(), 'the swipe passes `checking` too').toBe(0);
    await page.mouse.up();
});

test('calendar: a later month answered from the cache says so, and Try again re-checks it', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-09-16T09:00:00Z'));
    await seedMember(page);
    await seedMemberSession(page);
    await page.addInitScript(() => {
        const w = /** @type {any} */ (window); w.__E2E = w.__E2E || {};
        w.__E2E.docs = [{ id: 'nov', memberName: 'G. Miller', date: '2026-11-11',
            type: 'annual_leave', value: 'AL', note: '' }];
        // A device that read November whole on an earlier day — only that makes the cache's November a
        // saved copy (cal-data-3: rows another page cached one member at a time are not one).
        localStorage.setItem('myb_cal_whole_months', JSON.stringify(['2026-11']));
    });
    await page.goto('/');
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    await expect(page.locator('.calendar-stale-note')).toHaveCount(0);

    await page.evaluate(() => { /** @type {any} */ (window).__E2E.docsFromCache = true; });
    await page.locator('#nextMonth').click();
    await page.locator('#nextMonth').click();
    await expect(page.locator('.month-year').first()).toContainText('November');
    const note = page.locator('.calendar-stale-note');
    await expect(note).toBeVisible();
    await expect(note).toContainText('Saved copy');
    await expect(page.locator('.sync-chip'), 'one message at a time').toHaveCount(0);

    await page.evaluate(() => { /** @type {any} */ (window).__E2E.docsFromCache = false; });
    await note.getByRole('button', { name: 'Try again' }).click();
    await expect(page.locator('.calendar-stale-note')).toHaveCount(0);
    await expect(page.locator('.calendar-day').first()).toBeVisible();
});
