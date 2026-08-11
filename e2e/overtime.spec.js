/**
 * Overtime availability — the page in a real browser.
 *
 * The unit suites cover the rules; this covers what only a browser can answer: that the page
 * BOOTS (a coordinator whose `sessionReady` nothing resolves loads its shell and then waits for
 * ever — no error, no timeout), that `hidden` actually hides, and that the Manager's planning
 * horizon lists weeks nobody has created.
 */
import { test, expect } from './fixtures.js';
import { seedSession } from './helpers.js';

const NOW = Date.parse('2026-08-17T09:00:00Z');
const W = {
    weekEnding: '2026-09-05', weekStart: '2026-08-30',
    initialDeadlineAt: Date.parse('2026-08-18T11:00:00Z'), draftRosterDate: '2026-08-20',
    finalDeadlineAt: Date.parse('2026-08-25T11:00:00Z'), finalRosterDate: '2026-08-27',
    retentionUntil: Date.parse('2026-12-05T00:00:00Z'), policyVersion: 1, audience: 'restricted',
};

/** Stub the two read endpoints. `authUser` opts into the fixture's signed-in Firebase user. */
async function stubOvertime(page, { windows = [], weeks = [] } = {}) {
    await page.addInitScript(() => { window.__E2E = { ...(window.__E2E || {}), authUser: true }; });
    await page.route('**/getMyOvertimeState', r => r.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ ok: true, serverNow: NOW, windows }),
    }));
    await page.route('**/getOvertimeManagerOverview', r => r.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ ok: true, serverNow: NOW, planningWeeks: weeks, retained: [] }),
    }));
}

const openWindow = (over = {}) => ({ ...W, phase: 'INITIAL_OPEN', participant: { grade: 'CEA', rosterOrder: 2 }, submission: null, ...over });

/** The seven Sunday→Saturday dates, mirroring the server's `weekDates`. */
const weekDates = (weekStart) => {
    const [y, m, d] = weekStart.split('-').map(Number);
    return Array.from({ length: 7 }, (_, i) =>
        new Date(Date.UTC(y, m - 1, d + i)).toISOString().slice(0, 10));
};

const sixWeeks = () => [
    { ...W, weekEnding: '2026-08-22', exists: false, state: 'missed', canCreate: false },
    { ...W, weekEnding: '2026-08-29', exists: false, state: 'not-created-initial-passed', canCreate: true },
    { ...W, exists: true, state: 'created', canCreate: false, expected: 1, received: 0, noResponse: 1 },
    { ...W, weekEnding: '2026-09-12', exists: false, state: 'not-created', canCreate: true },
    { ...W, weekEnding: '2026-09-19', exists: false, state: 'not-created', canCreate: true },
    { ...W, weekEnding: '2026-09-26', exists: false, state: 'not-created', canCreate: true },
];

test.describe('member surface', () => {
    test('an open week renders all seven days, unanswered', async ({ page }) => {
        // The page BOOTING at all is half of what this asserts. The coordinator must establish the
        // Firebase session and resolve `sessionReady` itself — nothing else does — and when it did
        // not, the shell rendered and the card stayed permanently empty with no error anywhere.
        await seedSession(page, 'G. Miller');
        await stubOvertime(page, { windows: [openWindow()] });
        await page.goto('/overtime.html');
        await expect(page.locator('.ot-day')).toHaveCount(7);
        await expect(page.locator('.ot-day--answered')).toHaveCount(0);
        await expect(page.locator('.ot-submit')).toContainText('7 days still to answer');
    });

    test('several open weeks still land IN a form — the soonest-closing one', async ({ page }) => {
        // The regression automatic creation introduced. Filling the six-week horizon leaves FOUR or
        // FIVE windows open at once, permanently — so the old "one open week opens directly, several
        // get a list" rule meant every member, every visit, tapped through an index before reaching
        // anything they could fill in. The list was written for a case that stopped existing.
        await seedSession(page, 'G. Miller');
        const soonest = { ...openWindow(), weekEnding: '2026-09-05', finalDeadlineAt: Date.parse('2026-08-25T11:00:00Z') };
        const later   = { ...openWindow(), weekEnding: '2026-09-12', finalDeadlineAt: Date.parse('2026-09-01T11:00:00Z') };
        const latest  = { ...openWindow(), weekEnding: '2026-09-19', finalDeadlineAt: Date.parse('2026-09-08T11:00:00Z') };
        // Deliberately NOT in deadline order, so passing requires actually sorting rather than
        // taking the first element and happening to be right.
        await stubOvertime(page, { windows: [latest, soonest, later] });
        await page.goto('/overtime.html');

        await expect(page.locator('.ot-day')).toHaveCount(7);
        await expect(page.locator('.ot-form-week')).toContainText('5 September 2026');
        // The others are reachable, listed under the form rather than in front of it.
        await expect(page.locator('.ot-history-title')).toContainText('Other open weeks');
        await expect(page.locator('.ot-week-row')).toHaveCount(2);
    });

    test('answering a day marks it, and the button counts down', async ({ page }) => {
        await seedSession(page, 'G. Miller');
        await stubOvertime(page, { windows: [openWindow()] });
        await page.goto('/overtime.html');
        await page.locator('.ot-day').first().getByRole('radio', { name: 'Not available' }).click();
        await expect(page.locator('.ot-day--answered')).toHaveCount(1);
        await expect(page.locator('.ot-submit')).toContainText('6 days still to answer');
    });

    test('the chosen option LOOKS chosen — measured, not inferred from the markup', async ({ page }) => {
        // The defect this exists for shipped silently. The mode buttons became a radio group at
        // v20.61 (`aria-checked`) while the CSS kept styling `[aria-pressed="true"]`, so for several
        // releases pressing an option changed nothing visible: seven identical white rectangles, one
        // of which was your answer. Every behavioural assertion above still passed — the attribute
        // was correct, the answer was stored, the day was marked. Only the pixels were wrong.
        //
        // So this asserts the OUTCOME of the cascade rather than any selector, which is the only
        // form that survives the next reason it might break (a renamed attribute, a lost rule, a
        // specificity fight). Same reasoning as the 16px focusable-field sweep in pages.spec.js.
        await seedSession(page, 'G. Miller');
        await stubOvertime(page, { windows: [openWindow()] });
        await page.goto('/overtime.html');

        const day = page.locator('.ot-day').first();
        const chosen = day.getByRole('radio', { name: 'Available all day' });
        const other  = day.getByRole('radio', { name: 'Not available' });
        const fill = (loc) => loc.evaluate(el => getComputedStyle(el).backgroundColor);

        const before = await fill(chosen);
        await chosen.click();
        const after = await fill(chosen);
        expect(after, 'choosing an option must change how it looks').not.toBe(before);
        expect(after, 'the chosen option must be FILLED, not left transparent').not.toBe('rgba(0, 0, 0, 0)');
        expect(await fill(other), 'the unchosen options must not follow it').toBe(before);

        // And the other tone, because "available" and "not available" are the two answers a member
        // gives — a rule that only landed on one of them would still pass everything above.
        await other.click();
        const otherFill = await fill(other);
        expect(otherFill).not.toBe(before);
        expect(otherFill, 'the two tones must be distinguishable from each other').not.toBe(after);
    });

    test('a day states its roster with the app-wide shift badge, not prose', async ({ page }) => {
        // The one place this page says what somebody is already doing that day. Everywhere else in
        // the app that fact is a `.shift-badge` chip, and the member reads those on the calendar
        // every week — describing it in grey text here made the same fact look like a different one.
        await seedSession(page, 'G. Miller');
        await stubOvertime(page, { windows: [openWindow()] });
        await page.goto('/overtime.html');
        await expect(page.locator('.ot-day .ot-day-roster .shift-badge')).toHaveCount(7);
    });

    test('a saved answer keeps the time it was SAVED with when the shift later moves', async ({ page }) => {
        // The stored schema keeps concrete clock times precisely so a roster change cannot re-point
        // a declaration — and the button label was undoing that, because it was always built from
        // the CURRENT shift. A member who answered "After 15:00" and whose shift was afterwards
        // moved to 12:00–20:00 came back to a form showing "After 20:00", selected, while the
        // reviewer's screen read the same record as "Available after 15:00". Two people looking at
        // one answer and seeing different times, with nothing anywhere to say so.
        await seedSession(page, 'G. Miller');
        const dates = weekDates(W.weekStart);
        // What the roster says NOW.
        await page.addInitScript((rows) => {
            window.__E2E = { ...(window.__E2E || {}), docs: rows };
        }, dates.map(d => ({ id: `G. Miller|${d}`, memberName: 'G. Miller', date: d,
            type: 'shift', value: '12:00-20:00', note: '', source: 'manual' })));
        // What the member said EARLIER, when the shift finished at 15:00.
        const days = Object.fromEntries(dates.map(d => [d, { mode: 'after', from: '15:00' }]));
        await stubOvertime(page, { windows: [openWindow({ submission: { currentRevision: 1, days } })] });
        await page.goto('/overtime.html');

        const day = page.locator('.ot-day').first();
        await expect(day.locator('[role="radio"][aria-checked="true"]')).toHaveText('After 15:00');
        // The UNSELECTED options still offer the current roster, because that is what pressing one
        // would store. The two are different questions and each now gets its own answer.
        await expect(day.getByRole('radio', { name: 'Before 12:00' })).toBeVisible();
        // And the member is TOLD, rather than left to spot a two-digit difference.
        await expect(day.locator('.ot-day-stale')).toContainText('Your shift has changed');
        await expect(day.locator('.ot-day-stale')).toContainText('Available after 15:00');
    });

    test('opening another week runs the open routine ONCE, not once per list on the page', async ({ page }) => {
        // `wireWeekButtons` searched the whole card and was called twice — once for the open weeks,
        // once for the closed ones — so the second call re-wired the first list. One tap then ran
        // the whole routine twice: two roster reads, two full form renders, the first landing in a
        // node the second had already detached. Both runs produced identical markup, so no
        // assertion about the DOM could see it; the collection-read count is the observable.
        await seedSession(page, 'G. Miller');
        const other  = openWindow({ weekEnding: '2026-09-12', weekStart: '2026-09-06',
            finalDeadlineAt: Date.parse('2026-09-01T11:00:00Z') });
        const closed = openWindow({ weekEnding: '2026-08-22', weekStart: '2026-08-16', phase: 'CLOSED',
            submission: { currentRevision: 1, days: Object.fromEntries(
                weekDates('2026-08-16').map(d => [d, { mode: 'all_day' }])) } });
        await stubOvertime(page, { windows: [openWindow(), other, closed] });
        await page.goto('/overtime.html');
        // Both lists must actually be on the page, or this passes by not exercising the bug.
        await expect(page.locator('.ot-history-title')).toHaveCount(2);

        const reads = () => page.evaluate(() => (window.__E2E || {}).docReads || 0);
        const before = await reads();
        await page.locator('[data-openweek="2026-09-12"]').click();
        await expect(page.locator('.ot-form-week')).toContainText('12 September 2026');
        expect(await reads() - before, 'one tap, one roster read').toBe(1);
    });

    test('submitting an incomplete form refuses and names the day, rather than sitting disabled', async ({ page }) => {
        await seedSession(page, 'G. Miller');
        await stubOvertime(page, { windows: [openWindow()] });
        await page.goto('/overtime.html');
        await expect(page.locator('.ot-submit')).toBeEnabled();
        await page.locator('.ot-submit').click();
        await expect(page.locator('.ot-feedback')).toContainText('Answer Sun 30 Aug');
    });

    test('a closed week is read-only — no mode buttons, no submit', async ({ page }) => {
        await seedSession(page, 'G. Miller');
        await stubOvertime(page, { windows: [openWindow({
            phase: 'CLOSED',
            submission: { currentRevision: 1, days: Object.fromEntries(
                ['2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05']
                    .map(d => [d, { mode: 'all_day' }])) },
        })] });
        await page.goto('/overtime.html');
        await expect(page.locator('.ot-day')).toHaveCount(7);
        await expect(page.locator('.ot-mode')).toHaveCount(0);
        await expect(page.locator('.ot-submit')).toHaveCount(0);
        await expect(page.locator('.ot-closed-note')).toContainText('Final availability recorded');
    });

    test('no open forms is a distinct state from a load failure', async ({ page }) => {
        // One empty screen doing duty for both is the commonest way a page lies about itself, and
        // "nothing open" is the state most members meet most weeks.
        await seedSession(page, 'G. Miller');
        await stubOvertime(page, { windows: [] });
        await page.goto('/overtime.html');
        await expect(page.locator('#otMineContent')).toContainText('No overtime availability forms are open');
    });

    test('a failed load says so, and offers a retry', async ({ page }) => {
        await seedSession(page, 'G. Miller');
        await page.addInitScript(() => { window.__E2E = { ...(window.__E2E || {}), authUser: true }; });
        await page.route('**/getMyOvertimeState', r => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' }));
        await page.route('**/getOvertimeManagerOverview', r => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' }));
        await page.goto('/overtime.html');
        await expect(page.locator('#otMineContent')).toContainText("Couldn't load overtime availability");
        // The retry must be on the panel the member is LOOKING at. A reviewer whose own load fails
        // must not be silently switched to the workspace tab, which would replace the error with a
        // different card and read as the page ignoring them.
        await expect(page.locator('#otMineContent .ot-retry')).toBeVisible();
    });
});

test.describe('manager surface', () => {
    test('the planning horizon lists weeks that DO NOT EXIST', async ({ page }) => {
        // The single most important behaviour on this page. A list built from Firestore documents
        // can only show what exists; a week nobody created is the failure worth seeing.
        await seedSession(page, 'H. Croft');
        await stubOvertime(page, { weeks: sixWeeks() });
        await page.goto('/overtime.html');
        await expect(page.locator('.ot-week-row')).toHaveCount(6);
        await expect(page.locator('#otHorizonContent')).toContainText('no form was opened, so nobody was asked');
        await expect(page.locator('#otHorizonChip')).toContainText('5 without a form');
    });

    test('a missed week offers no Create; a recoverable one does', async ({ page }) => {
        await seedSession(page, 'H. Croft');
        await stubOvertime(page, { weeks: sixWeeks() });
        await page.goto('/overtime.html');
        const missed = page.locator('.ot-week-row').first();
        await expect(missed).toContainText('Missed');
        // Since automatic creation, a week that has no form yet is not a job waiting for the
        // reviewer — it opens overnight. The row must say that rather than demand a press.
        await expect(page.locator('#otHorizonContent')).toContainText('Opens automatically overnight');
        await expect(missed.getByRole('button')).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Open now' })).toHaveCount(4);
    });

    test('a manager gets no personal form, and no tab strip offering one', async ({ page }) => {
        // `getMyOvertimeState` correctly returns [] for a reviewer who is not a participant. The
        // tab strip must not appear, or it would lead somewhere that says "nothing open for you".
        await seedSession(page, 'H. Croft');
        await stubOvertime(page, { windows: [], weeks: sixWeeks() });
        await page.goto('/overtime.html');
        await expect(page.locator('#otTabs')).toBeHidden();
        await expect(page.locator('#otHorizonContent')).toBeVisible();
    });

    test('a preview arms the bar; a FAILED preview leaves it disarmed and says so', async ({ page }) => {
        // Two halves of one rule, in one test because either alone passes on the bug. The bar stays
        // on screen carrying the failure — and the button beside that failure used to stay enabled
        // while `pendingWeek` was null, so pressing it did nothing at all. A live-looking control
        // that silently refuses is the worst thing to hand somebody who has just been told
        // something went wrong.
        await seedSession(page, 'H. Croft');
        await stubOvertime(page, { weeks: sixWeeks() });
        let fail = false;
        await page.route('**/createOvertimeWindow', r => (fail
            ? r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'invalid-week' }) })
            : r.fulfill({
                status: 200, contentType: 'application/json',
                body: JSON.stringify({ ok: true, dryRun: true, window: { ...W, expectedCount: 1 } }),
            })));
        await page.goto('/overtime.html');

        await page.getByRole('button', { name: 'Open now' }).first().click();
        await expect(page.locator('#otConfirmBar')).toBeVisible();
        await expect(page.locator('#otConfirmText')).toContainText('1 expected participant');
        await expect(page.locator('#otConfirmCreate')).toBeEnabled();

        fail = true;
        await page.getByRole('button', { name: 'Open now' }).nth(1).click();
        await expect(page.locator('#otConfirmText')).toContainText("Couldn't prepare that week");
        await expect(page.locator('#otConfirmCreate')).toBeDisabled();
    });

    test('the week being planned is already open — View switches week, it is not a gate', async ({ page }) => {
        // The same step removed from the member's side at v20.64, which should have been removed
        // from both surfaces at once: they are the same rows rendered by the same coordinator. A
        // reviewer arrived on a list and had to press View before seeing any availability at all.
        await seedSession(page, 'H. Croft');
        await stubOvertime(page, { weeks: sixWeeks() });
        await page.goto('/overtime.html');
        // The detail card is open on arrival, on the earliest week that HAS a form — not the first
        // row, which is a missed week with nothing to show.
        await expect(page.locator('#otWeekCard')).toBeVisible();
        await expect(page.locator('#otWeekHint')).toContainText('5 September 2026');
        // And the row it opened is marked as the one being shown.
        await expect(page.locator('[data-open="2026-09-05"]')).toHaveAttribute('aria-pressed', 'true');
    });

    test('it lands on the week being PLANNED, not the finished one at the top of the list', async ({ page }) => {
        // The realistic horizon, which the fixture above never produced: the daily scheduler means
        // every week that CAN exist does, and the first row is always the current week — whose final
        // deadline is eleven days behind it and whose roster is already published.
        //
        // So "the earliest week with a form" landed the reviewer on a finished week every single
        // visit, and they had to press View to reach the one they were actually planning: the exact
        // gate v20.67 set out to remove, still there, just less visible.
        await seedSession(page, 'H. Croft');
        const closedWeek = { ...W, weekEnding: '2026-08-15', weekStart: '2026-08-09',
            finalDeadlineAt: Date.parse('2026-08-04T11:00:00Z'), exists: true, state: 'created-closed',
            canCreate: false, expected: 4, received: 4, noResponse: 0 };
        const openWeek = { ...W, exists: true, state: 'created', canCreate: false,
            expected: 4, received: 3, noResponse: 1 };
        await stubOvertime(page, { weeks: [closedWeek, openWeek] });
        await page.goto('/overtime.html');

        await expect(page.locator('#otWeekHint')).toContainText('5 September 2026');
        await expect(page.locator('[data-open="2026-09-05"]')).toHaveAttribute('aria-pressed', 'true');
        // And the finished week says so rather than claiming to be open — both halves matter, since
        // a row reading "Form open" is what made landing on it look deliberate.
        await expect(page.locator('.ot-week-row').first()).toContainText('Form closed');
        await expect(page.locator('.ot-week-row').nth(1)).toContainText('Form open');
    });

    test('with every week closed it still opens the most recent, rather than nothing', async ({ page }) => {
        // The fallback. Only reachable when creation has fallen a long way behind, and a reviewer
        // looking at a closed week is better served than one looking at an empty card.
        await seedSession(page, 'H. Croft');
        const closed = (weekEnding) => ({ ...W, weekEnding, exists: true, state: 'created-closed',
            canCreate: false, expected: 1, received: 1, noResponse: 0 });
        await stubOvertime(page, { weeks: [closed('2026-08-15'), closed('2026-08-22')] });
        await page.goto('/overtime.html');
        await expect(page.locator('#otWeekHint')).toContainText('22 August 2026');
    });

    test('with no week created at all, nothing is force-opened', async ({ page }) => {
        // Guard the guard: auto-opening must not invent a selection when there is none to make,
        // which would leave an empty card asserting a week that does not exist.
        await seedSession(page, 'H. Croft');
        await stubOvertime(page, { weeks: sixWeeks().map(w => ({ ...w, exists: false, state: 'not-created' })) });
        await page.goto('/overtime.html');
        await expect(page.locator('#otHorizonContent')).toBeVisible();
        await expect(page.locator('#otWeekCard')).toBeHidden();
    });

    test('weeks that have already run are reachable, not just the six ahead', async ({ page }) => {
        // The server has always sent `retained` — every week still inside the 13-week retention —
        // and the page fetched it and threw it away. So a week became unreachable the moment its
        // Saturday passed, while the member's own screen promised their forms were kept for 13
        // weeks. "Who was available when we made that call?" had no answer, from data already
        // crossing the wire.
        await seedSession(page, 'H. Croft');
        await page.addInitScript(() => { window.__E2E = { ...(window.__E2E || {}), authUser: true }; });
        await page.route('**/getMyOvertimeState', r => r.fulfill({
            status: 200, contentType: 'application/json',
            body: JSON.stringify({ ok: true, serverNow: NOW, windows: [] }),
        }));
        await page.route('**/getOvertimeManagerOverview', r => r.fulfill({
            status: 200, contentType: 'application/json',
            body: JSON.stringify({
                ok: true, serverNow: NOW, planningWeeks: sixWeeks(),
                retained: [
                    { ...W, weekEnding: '2026-08-08', finalDeadlineAt: Date.parse('2026-07-28T11:00:00Z') },
                    { ...W, weekEnding: '2026-08-01', finalDeadlineAt: Date.parse('2026-07-21T11:00:00Z') },
                    // Already in the horizon — it must not be listed twice.
                    { ...W },
                ],
            }),
        }));
        await page.goto('/overtime.html');
        await expect(page.locator('.ot-history-title')).toContainText('Previous weeks');
        await expect(page.locator('.ot-week-row--past')).toHaveCount(2);
        await expect(page.locator('.ot-week-row--past').first()).toContainText('8 August 2026');
        // Reachable, not merely listed.
        await expect(page.locator('.ot-week-row--past').first().getByRole('button', { name: 'View' })).toBeVisible();
    });

    test('counts distinguish no response from unavailable', async ({ page }) => {
        await seedSession(page, 'H. Croft');
        await stubOvertime(page, { weeks: sixWeeks() });
        await page.goto('/overtime.html');
        await expect(page.locator('#otHorizonContent')).toContainText('0 of 1 form received · 1 no response');
    });
});

test.describe('access and chrome', () => {
    test('an ordinary member sees no page content and no nav pill', async ({ page }) => {
        await seedSession(page, 'S. Silva');
        await stubOvertime(page, { windows: [openWindow()] });
        await page.goto('/overtime.html');
        await expect(page.locator('#otMineContent')).toContainText("isn't open to everyone yet");
        await expect(page.locator('.ot-day')).toHaveCount(0);
        await page.locator('#navMenuBtn').click();
        await expect(page.locator('.nav-panel-pill--overtime')).toHaveCount(0);
    });

    test('a reviewer DOES get the nav pill', async ({ page }) => {
        // Guard the guard: the assertion above passes against a drawer that renders no pills at all.
        await seedSession(page, 'H. Croft');
        await stubOvertime(page, { weeks: sixWeeks() });
        await page.goto('/overtime.html');
        await page.locator('#navMenuBtn').click();
        await expect(page.locator('.nav-panel-pill--overtime')).toHaveCount(1);
    });

    test('the pill is reachable from OTHER pages, which is the only way anyone finds it', async ({ page }) => {
        // The shipped bug, and the reason the assertion above is not enough on its own: it opens the
        // drawer on overtime.html, the one page whose coordinator passed `isOvertimeReviewer`. Every
        // other page defaulted it to false, so the pill appeared only where you already were and the
        // feature was reachable by typing its URL and by nothing else.
        //
        // The calendar is the page that matters — it is where a signed-in reviewer starts.
        await seedSession(page, 'H. Croft');
        await stubOvertime(page);
        await page.goto('/');
        await page.locator('#navMenuBtn').click();
        await expect(page.locator('.nav-panel-pill--overtime')).toHaveCount(1);

        // And still absent for someone who is not a reviewer — the fix must not have widened it.
        await page.context().clearCookies();
        await seedSession(page, 'S. Silva');
        await page.goto('/');
        await page.locator('#navMenuBtn').click();
        await expect(page.locator('.nav-panel-pill--overtime')).toHaveCount(0);
    });

    test('every signed-in page offers the reviewer the pill', async ({ page }) => {
        // One page passing the flag is what shipped. Sweep them all rather than trusting that the
        // fix was applied uniformly — six near-identical edits is exactly where one gets missed.
        await seedSession(page, 'G. Miller');       // admin: sees every pill, so no page is skipped
        await stubOvertime(page);
        for (const path of ['/', '/admin.html', '/paycalc.html', '/settings.html', '/operations.html', '/links.html']) {
            await page.goto(path);
            // Several pages open a one-time notice on a fresh profile (links has a welcome panel,
            // paycalc a Year-to-Date prompt). They are modal, so they cover the burger — dismiss
            // whatever is up rather than seeding a per-page flag this test would then have to track.
            const close = page.locator('.lb-overlay.open .lb-close').first();
            if (await close.count()) await close.click();
            await page.locator('#navMenuBtn').click();
            await expect(page.locator('.nav-panel-pill--overtime'),
                `no Overtime pill in the drawer on ${path}`).toHaveCount(1);
        }
    });

    test('hidden really hides — the confirm bar is not on screen at rest', async ({ page }) => {
        // `display: flex` out-specifies the `hidden` attribute, so this bar covered the bottom of
        // every page view until its companion rule was added. A fixed element, so it was not subtle.
        await seedSession(page, 'H. Croft');
        await stubOvertime(page, { weeks: sixWeeks() });
        await page.goto('/overtime.html');
        await expect(page.locator('#otConfirmBar')).toBeHidden();
    });
});
