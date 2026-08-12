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

    test('the page reports the `ready` milestone, and it lands after the form does', async ({ page }) => {
        // The App Speed card's "Usable" column reads a `myb-page-ready` performance mark, and this
        // page had none — so it showed an em-dash where every other page shows a bar, and its two
        // remaining metrics were both measuring the LOADING PLACEHOLDER. `fcp` paints the shell and
        // `domReady` fires while `getMyOvertimeState` is still in flight; neither can see the form.
        //
        // The ordering assertion is the substance. A mark placed anywhere in `init()` would satisfy
        // "the mark exists" while measuring exactly the thing that was wrong before — so this pins
        // that it is written AFTER DOMContentLoaded, which is the only way it can be describing
        // content rather than scripts.
        await seedSession(page, 'G. Miller');
        await stubOvertime(page, { windows: [openWindow()] });
        await page.goto('/overtime.html');
        await expect(page.locator('.ot-day')).toHaveCount(7);
        const t = await page.evaluate(() => ({
            ready: performance.getEntriesByName('myb-page-ready')[0]?.startTime ?? null,
            dcl:   performance.getEntriesByType('navigation')[0]?.domContentLoadedEventEnd ?? null,
        }));
        expect(t.ready, 'no mark means the App Speed card prints "—" for this page').not.toBeNull();
        expect(t.ready).toBeGreaterThan(t.dcl);
    });

    test('the form names BOTH deadlines, and leads with the one still to come', async ({ page }) => {
        // Until v20.86 the only date on the page was the FINAL one, so a member reading it would
        // reasonably conclude they had until then. They do, technically — a submission at the final
        // deadline is accepted — but it arrives after the week has been planned, which is the whole
        // distinction the two deadlines exist to draw. An answer that is accepted and too late to
        // be used is the worst outcome this feature can produce: everyone believes it worked.
        await seedSession(page, 'G. Miller');
        await stubOvertime(page, { windows: [openWindow()] });
        await page.goto('/overtime.html');
        const meta = page.locator('.ot-form-meta');
        await expect(meta).toContainText('Answers due');
        await expect(meta).toContainText('18 Aug');       // the initial deadline
        await expect(meta).toContainText('25 Aug');       // the final one, still stated
        // One emphasised date, and it is the live one — printing both flat would leave the member
        // working out which applies today, which is the job this is meant to be doing for them.
        await expect(page.locator('.ot-form-when--lead')).toHaveCount(1);
        await expect(page.locator('.ot-form-when--lead')).toContainText('18 Aug');
    });

    test('a submitted form carries a standing receipt, not just green rows', async ({ page }) => {
        // Green day rows say what each ANSWER is; they do not say the form was ever accepted. The
        // line that did say so lived in the transient feedback and never survived a reload, so the
        // strongest evidence on screen was an inference from seven colours.
        await seedSession(page, 'G. Miller');
        const days = Object.fromEntries(weekDates(W.weekStart).map(d => [d, { mode: 'unavailable' }]));
        await stubOvertime(page, { windows: [openWindow({ submission: {
            currentRevision: 1, days, updatedAt: Date.parse('2026-08-16T08:42:00Z') } })] });
        await page.goto('/overtime.html');
        await expect(page.locator('.ot-form-receipt')).toContainText('Submitted');
        await expect(page.locator('.ot-form-receipt')).toContainText('16 Aug');
    });

    test('an unsubmitted form carries no receipt at all', async ({ page }) => {
        // The teeth on the one above: a receipt that renders unconditionally would satisfy it and
        // tell every member their blank form had been submitted.
        await seedSession(page, 'G. Miller');
        await stubOvertime(page, { windows: [openWindow()] });
        await page.goto('/overtime.html');
        await page.locator('.ot-day').first().waitFor();
        await expect(page.locator('.ot-form-receipt')).toHaveCount(0);
    });

    test('the form it lands on is the soonest one still to DO, not the soonest full stop', async ({ page }) => {
        // The response-rate defect: sorting on deadline alone lands a member on a form they have
        // already dealt with whenever the nearest deadline belongs to a completed week. The page is
        // answering "what do I need to do?", and a green screen is not an answer to it.
        await seedSession(page, 'G. Miller');
        const days = Object.fromEntries(weekDates(W.weekStart).map(d => [d, { mode: 'unavailable' }]));
        const doneSoon = { ...openWindow(), weekEnding: '2026-09-05',
            finalDeadlineAt: Date.parse('2026-08-25T11:00:00Z'),
            submission: { currentRevision: 1, days, updatedAt: NOW } };
        const todoLater = { ...openWindow(), weekEnding: '2026-09-12', weekStart: '2026-09-06',
            finalDeadlineAt: Date.parse('2026-09-01T11:00:00Z') };
        await stubOvertime(page, { windows: [doneSoon, todoLater] });
        await page.goto('/overtime.html');
        await expect(page.locator('.ot-form-week')).toContainText('12 September 2026');
        // The completed week is not hidden — it is listed, which is where a finished thing belongs.
        await expect(page.locator('.ot-week-row')).toContainText('5 September 2026');
    });

    test('and with every open form submitted it lands on the soonest, with no nudge', async ({ page }) => {
        // The fallback has to be a real form rather than an empty state: an all-submitted member
        // still has something to look at, and might still amend it.
        await seedSession(page, 'G. Miller');
        const days = Object.fromEntries(weekDates(W.weekStart).map(d => [d, { mode: 'unavailable' }]));
        const sub = { currentRevision: 1, days, updatedAt: NOW };
        await stubOvertime(page, { windows: [
            { ...openWindow(), submission: sub },
            { ...openWindow(), weekEnding: '2026-09-12', weekStart: '2026-09-06',
                finalDeadlineAt: Date.parse('2026-09-01T11:00:00Z'), submission: sub },
        ] });
        await page.goto('/overtime.html');
        await expect(page.locator('.ot-form-week')).toContainText('5 September 2026');
        await expect(page.locator('.ot-outstanding'), 'nothing outstanding, so nothing to say')
            .toHaveCount(0);
    });

    test('after submitting, a member with another form outstanding is told once', async ({ page }) => {
        // The nudge is a POST-SUBMIT state by construction: the page leads with an unanswered form,
        // so while anything is outstanding the member is already looking at it and has nothing to
        // be pointed at. It becomes true the moment they finish one — which is exactly the moment
        // they would otherwise close the page believing they were done.
        await seedSession(page, 'G. Miller');
        const w2 = { ...openWindow(), weekEnding: '2026-09-12', weekStart: '2026-09-06',
            finalDeadlineAt: Date.parse('2026-09-01T11:00:00Z') };
        await stubOvertime(page, { windows: [openWindow(), w2] });
        await page.route('**/submitOvertimeAvailability', r => r.fulfill({
            status: 200, contentType: 'application/json',
            body: JSON.stringify({ ok: true, revision: 1, created: true, phase: 'INITIAL_OPEN', serverNow: NOW }) }));
        await page.goto('/overtime.html');
        await page.locator('.ot-day').first().waitFor();
        // Nothing yet — they are ON the outstanding work, so there is nothing to point at.
        await expect(page.locator('.ot-outstanding')).toHaveCount(0);
        for (let i = 0; i < 7; i++) {
            await page.locator('.ot-day').nth(i).getByRole('radio', { name: 'Not available' }).click();
        }
        await page.locator('.ot-submit').click();
        await expect(page.locator('.ot-feedback')).toContainText('submitted');
        await expect(page.locator('.ot-outstanding')).toContainText('1 other form still needs a response');
        // The confirmation the member is reading must survive the list repaint — re-rendering the
        // form to update a note about a DIFFERENT week would take away the thing they came for.
        await expect(page.locator('.ot-feedback')).toContainText('submitted');
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
        const chosen = day.getByRole('radio', { name: 'All day' });
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

    test('printing the MEMBER form gives a notice, not a page of empty capsules', async ({ page }) => {
        // A form is a set of controls. On paper it is seven rows of blank pills — nothing to read,
        // and a real risk somebody fills it in with a pen believing it counts. Same treatment admin,
        // operations and settings use, for the same reason.
        await seedSession(page, 'G. Miller');
        await stubOvertime(page, { windows: [openWindow()] });
        await page.goto('/overtime.html');
        await page.locator('.ot-day').first().waitFor();

        await page.emulateMedia({ media: 'print' });
        await expect(page.locator('.app')).toBeHidden();
        const notice = await page.evaluate(() =>
            getComputedStyle(document.body, '::before').content);
        expect(notice).toContain('nothing on this page to print');
    });

    test('printing the REVIEWER view keeps all seven days, even when the screen shows one', async ({ page }) => {
        // The one print assertion with real teeth. The glance chips filter the day panels with the
        // `hidden` attribute; printing that state would produce a call sheet silently missing six
        // days — and a printed page cannot be tapped to find out what is not on it.
        await seedSession(page, 'H. Croft');
        await stubOvertime(page, { weeks: [{ ...W, exists: true, state: 'created', canCreate: false,
            expected: 1, received: 0, noResponse: 1 }] });
        await page.goto('/overtime.html');
        await page.locator('.ot-day-panel').first().waitFor();

        const shownDays = () => page.locator('.ot-day-panel[data-date]').evaluateAll(els =>
            els.filter(e => getComputedStyle(e).display !== 'none').length);

        await page.locator('[data-glance]').nth(2).click();
        expect(await shownDays(), 'the SCREEN filters to one day').toBe(1);

        await page.emulateMedia({ media: 'print' });
        expect(await shownDays(), 'the SHEET carries the whole week').toBe(7);
        // And it names itself: a page of names with no week on it can still be acted on.
        await expect(page.locator('.ot-print-head')).toBeVisible();
        await expect(page.locator('.ot-print-title')).toContainText('Week ending');
        await expect(page.locator('.ot-print-asat')).toContainText('as at');
        // The horizon is planning, not cover-filling — it would push the sheet to a second page.
        await expect(page.locator('#otHorizonCard')).toBeHidden();
    });

    test('and that print head is NOT on screen, where the card header already says the week', async ({ page }) => {
        await seedSession(page, 'H. Croft');
        await stubOvertime(page, { weeks: [{ ...W, exists: true, state: 'created', canCreate: false,
            expected: 1, received: 0, noResponse: 1 }] });
        await page.goto('/overtime.html');
        await page.locator('.ot-day-panel').first().waitFor();
        await expect(page.locator('.ot-print-head')).toBeHidden();
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

test.describe('opening a week — the press has to land', () => {
    /** Stub the dry run so it is still in flight when we look at the page. */
    async function stubSlowPreview(page, delayMs) {
        await page.route('**/createOvertimeWindow', async (r) => {
            await new Promise(res => setTimeout(res, delayMs));
            await r.fulfill({
                status: 200, contentType: 'application/json',
                body: JSON.stringify({ ok: true, window: { ...W, expectedCount: 1 } }),
            });
        });
    }

    test('"Open now" says so while the request is in flight', async ({ page }) => {
        // THE DEFECT THIS PINS. The press fired a Cloud Function call and changed nothing at all —
        // measured at 390px against a 2.5s response, the viewport was byte-for-byte identical
        // before and during. A control that shows nothing has not visibly happened, so the
        // reasonable thing to do is press it again, which is exactly what was reported: "it still
        // keeps saying Open now".
        //
        // The assertion is deliberately made DURING the call, not after. Asserting the settled
        // state would pass on the broken code, because the broken code also ends up correct — it
        // just spends the intervening seconds looking dead.
        await seedSession(page, 'H. Croft');
        await stubOvertime(page, { weeks: sixWeeks() });
        await stubSlowPreview(page, 2000);
        await page.goto('/overtime.html');

        const creates = page.locator('[data-create]');
        await expect(creates).toHaveCount(4);
        const pressed = creates.nth(1);
        await pressed.click();

        await expect(pressed).toHaveText(/Opening/);
        await expect(pressed).toBeDisabled();
        // Every OTHER create button locks too. Two previews in flight resolve into the one confirm
        // bar, which names a single week — so the reviewer would be reading a question about the
        // week they pressed first beside an answer about the week they pressed second.
        await expect(creates.nth(0)).toBeDisabled();
        await expect(creates.nth(3)).toBeDisabled();

        // And it comes BACK. A button left disabled on a slow path is a page you have to reload.
        await expect(pressed).toHaveText('Open now', { timeout: 6000 });
        await expect(creates.nth(0)).toBeEnabled();
    });

    test('the confirm bar cannot cover the row it is asking about', async ({ page }) => {
        // The bar is `position: fixed; bottom: 0` and measured 199px tall at 390px — taller than a
        // week row — with nothing reserving its space. So it hid the last rows of the list, and
        // pressing "Open now" on the LAST week put the question directly on top of the week it
        // named. The page could not be scrolled far enough to see it, because the page did not know
        // the bar was there.
        await page.setViewportSize({ width: 390, height: 844 });
        await seedSession(page, 'H. Croft');
        await stubOvertime(page, { weeks: sixWeeks() });
        await stubSlowPreview(page, 0);
        await page.goto('/overtime.html');

        const creates = page.locator('[data-create]');
        await creates.last().click();
        const bar = page.locator('#otConfirmBar');
        await expect(bar).toBeVisible();

        // The property is REACHABILITY at the END OF THE PAGE, and it has to be asserted there.
        // A fixed bar always overlaps something at some scroll position, and any row with content
        // beneath it can be scrolled clear whether or not the space is reserved — an earlier
        // version of this test checked the last week ROW and passed with the defect reintroduced.
        // What the reservation actually buys is that the page can scroll far enough for its own
        // last pixel to come out from under the bar. Without it the document simply ends at the
        // viewport and everything in the bar's 199px is unreachable for good.
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(200);
        const appBottom = await page.evaluate(() =>
            document.querySelector('main.app').getBoundingClientRect().bottom);
        const barTop = (await bar.boundingBox()).y;
        expect(appBottom, 'the end of the page is scrollable clear of the bar')
            .toBeLessThanOrEqual(barTop + 1);

        // Cancelling gives the space back — otherwise the page keeps a dead gap for the rest of
        // the visit, which reads as the list having ended early.
        await page.locator('#otConfirmCancel').click();
        await expect(bar).toBeHidden();
        expect(await page.evaluate(() => document.body.style.paddingBottom)).toBe('');
    });
});

test('the member form fills the desktop band, and the day row goes horizontal in it', async ({ page }) => {
    // v20.72 gave this page the app's 1100px band and then capped the form panel at 620px, LEFT
    // ALIGNED inside it — so the desktop page carried a 480px navy void down its right side and
    // read as a layout that had failed rather than one that had chosen. Reported as "on desktop it
    // has gone a little strange", which is exactly what a narrow column in a wide band looks like.
    //
    // Two assertions, because the fix is two halves and either alone is wrong: the panel takes the
    // band (or the void returns), and the day row absorbs the width (or the band is full of a
    // narrow ribbon of content, which is the same problem one level in).
    await page.setViewportSize({ width: 1440, height: 1000 });
    await seedSession(page, 'G. Miller');
    await stubOvertime(page, { windows: [openWindow()] });
    await page.goto('/overtime.html');
    await page.locator('.ot-day').first().waitFor();

    const app   = await page.locator('main.app').boundingBox();
    const panel = await page.locator('#otMinePanel').boundingBox();
    expect(panel.width, 'the form panel takes the whole band').toBe(app.width);

    // Side by side, not stacked: the day name and its roster badge sit in a fixed left column with
    // the mode buttons beside them. Compared as EDGES rather than by reading the CSS — the same
    // rule can be defeated by a wrapping child or a later declaration, and neither shows in source.
    const head  = await page.locator('.ot-day').first().locator('.ot-day-head').boundingBox();
    const modes = await page.locator('.ot-day').first().locator('.ot-modes').boundingBox();
    expect(modes.x, 'the buttons start after the day name, not beneath it')
        .toBeGreaterThanOrEqual(head.x + head.width);
    expect(Math.abs((modes.y + modes.height / 2) - (head.y + head.height / 2)),
        'and on the same line as it').toBeLessThan(12);
});

test('and on a phone the day row is still stacked, where there is no room for anything else', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedSession(page, 'G. Miller');
    await stubOvertime(page, { windows: [openWindow()] });
    await page.goto('/overtime.html');
    await page.locator('.ot-day').first().waitFor();
    const head  = await page.locator('.ot-day').first().locator('.ot-day-head').boundingBox();
    const modes = await page.locator('.ot-day').first().locator('.ot-modes').boundingBox();
    expect(modes.y, 'the buttons sit below the day name').toBeGreaterThanOrEqual(head.y + head.height);
});

test.describe('the v20.75 review fixes, each pinned in a browser', () => {
    const D = ['2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05'];
    /** Roster overrides giving the week a NIGHT duty (dispatcher shape) and a plain rest day. */
    const OVR = [
        { id: 'o1', memberName: 'G. Miller', date: D[2], type: 'shift',      value: '22:00-07:00', note: '', source: 'manual' },
        { id: 'o2', memberName: 'G. Miller', date: D[4], type: 'correction', value: 'RD',          note: '', source: 'manual' },
        // A plain SAME-DAY duty as the control case. An override, not the base roster: the base
        // for this member/week is SPARE (no times), which would make the control assert nothing.
        { id: 'o3', memberName: 'G. Miller', date: D[6], type: 'shift',      value: '15:15-23:55', note: '', source: 'manual' },
    ];
    const winOver = (over = {}) => ({ ...W, phase: 'FINAL_OPEN',
        participant: { grade: 'CEA', rosterOrder: 2 }, submission: null, ...over });

    async function stubWithRoster(page, windows, docs) {
        await page.addInitScript((rows) => {
            window.__E2E = { ...(window.__E2E || {}), authUser: true, docs: rows };
        }, docs);
        await page.route('**/getMyOvertimeState', r => r.fulfill({
            status: 200, contentType: 'application/json',
            body: JSON.stringify({ ok: true, serverNow: NOW, windows }),
        }));
        await page.route('**/getOvertimeManagerOverview', r => r.fulfill({
            status: 200, contentType: 'application/json',
            body: JSON.stringify({ ok: true, serverNow: NOW, planningWeeks: [], retained: [] }),
        }));
    }

    test('an overnight duty offers no anchor the server would refuse', async ({ page }) => {
        // Dispatchers are the only grade rostered across midnight. Before v20.75 a 22:00–07:00 day
        // offered "Before & after duty" — whose stored answer (until 22:00 > from 07:00) the server
        // refuses as inverted — and "After 07:00", which describes a morning the duty itself owns.
        // The button was pressable and every press ended in a failed submit.
        await seedSession(page, 'G. Miller');
        await stubWithRoster(page, [winOver()], OVR);
        await page.goto('/overtime.html');
        const night = page.locator(`[data-day="${D[2]}"]`);
        await night.waitFor();
        const offered = await night.locator('[data-mode]').allTextContents();
        expect(offered).toContain('Before 22:00');     // the pre-duty gap is real and stays
        expect(offered).not.toContain('After 07:00');
        expect(offered).not.toContain('Before & after duty');
        // An ordinary same-day duty is untouched — the fix narrows the overnight case only.
        const late = page.locator(`[data-day="${D[6]}"]`);
        expect(await late.locator('[data-mode]').allTextContents()).toContain('Before & after duty');
    });

    test('"Up to 12 hours" is withheld only where the day already reaches 12 rostered hours (v20.83)', async ({ page }) => {
        // The owner's rule end-to-end: a 12-hour RDW already agreed as extra gates the offer on
        // THAT day, while a spare day and an ordinary duty keep it. Driven through the real
        // roster loader — override read, resolveEffectiveShift, span maths — not a stubbed ctx.
        await seedSession(page, 'G. Miller');
        const twelve = [...OVR,
            { id: 'o4', memberName: 'G. Miller', date: D[3], type: 'rdw', value: '09:00-21:00', note: '', source: 'manual' }];
        await stubWithRoster(page, [winOver()], twelve);
        await page.goto('/overtime.html');
        await page.locator(`[data-day="${D[3]}"]`).waitFor();

        // Not by label — by MODE. The label is context-dependent since v20.86 and asserting on its
        // words would pass a build that offered the option under the other wording.
        await expect(page.locator(`[data-day="${D[3]}"] [data-mode="twelve_hours"]`)).toHaveCount(0);
        // A spare day (no times) and an 8.7-hour duty both leave headroom, so both offer it.
        await expect(page.locator(`[data-day="${D[0]}"] [data-mode="twelve_hours"]`)).toHaveCount(1);
        await expect(page.locator(`[data-day="${D[6]}"] [data-mode="twelve_hours"]`)).toHaveCount(1);

        // ── AND THE SAME OPTION IS WORDED FOR THE DAY IT SITS ON (owner, Aug 2026) ──────────────
        //
        // The rule is that twelve hours is a TOTAL including whatever is rostered. On a rest day
        // there is nothing to include, so "a 12-hour turn" says it exactly; beside a duty the same
        // phrase is ambiguous by eight hours — a clerk could read 07:00–19:00 or 04:00–16:00 from
        // it. Nothing errors if these drift back to one phrase, which is why it is pinned here.
        await expect(page.locator(`[data-day="${D[0]}"] [data-mode="twelve_hours"]`))
            .toHaveText('Up to a 12-hour turn');
        await expect(page.locator(`[data-day="${D[6]}"] [data-mode="twelve_hours"]`))
            .toHaveText('Up to 12 hours in total');
        // And it submits like any other answer — the label is a real option, not a decoration.
        await page.locator(`[data-day="${D[0]}"] [data-mode="twelve_hours"]`).click();
        await expect(page.locator(`[data-day="${D[0]}"] [data-mode="twelve_hours"]`)).toHaveAttribute('aria-checked', 'true');
    });

    test('the day rows speak admin\'s state grammar — cream over a changed saved answer (v20.83)', async ({ page }) => {
        // Green = recorded, gold = chosen but nothing saved yet, CREAM = about to overwrite a
        // saved answer. The classes are asserted (page-css-parity proves they are styled); the
        // paint itself is locked by the visual baselines.
        await seedSession(page, 'G. Miller');
        const saved = Object.fromEntries(D.map(d => [d, { mode: 'unavailable' }]));
        delete saved[D[1]];   // one day deliberately unanswered
        const days = { ...saved };
        await stubWithRoster(page, [winOver({ submission: { currentRevision: 1, days } })], OVR);
        await page.goto('/overtime.html');
        await page.locator('.ot-day').first().waitFor();

        // Wait — a saved week is seven answers; the fixture leaves D[1] out, so six saved.
        await expect(page.locator(`[data-day="${D[0]}"]`)).toHaveClass(/ot-day--saved/);
        await expect(page.locator(`[data-day="${D[1]}"]`)).not.toHaveClass(/ot-day--saved|ot-day--set|ot-day--changed/);

        // Choosing on the unanswered day → gold "ready to save", never cream: nothing is overwritten.
        await page.locator(`[data-day="${D[1]}"] [data-mode="all_day"]`).click();
        await expect(page.locator(`[data-day="${D[1]}"]`)).toHaveClass(/ot-day--set/);

        // Changing a SAVED day → cream, the same "you are about to overwrite something recorded"
        // admin's week grid wears for exactly this.
        await page.locator(`[data-day="${D[0]}"] [data-mode="all_day"]`).click();
        await expect(page.locator(`[data-day="${D[0]}"]`)).toHaveClass(/ot-day--changed/);

        // Re-choosing the saved mode reads as untouched again — key order and structural equality,
        // so a member who wanders and returns is not left under a warning tint.
        await page.locator(`[data-day="${D[0]}"] [data-mode="unavailable"]`).click();
        await expect(page.locator(`[data-day="${D[0]}"]`)).toHaveClass(/ot-day--saved/);
    });

    test('re-pressing a saved anchored answer keeps it, even when the roster lost its time', async ({ page }) => {
        // The stale note says "change it if that no longer suits", inviting a tap on the selected
        // pill. Before v20.75 that tap rebuilt the answer from the CURRENT roster — a rest day, no
        // times — producing until:'' and a server refusal on a day that still rendered as answered.
        await seedSession(page, 'G. Miller');
        const saved = Object.fromEntries(D.map(d => [d, { mode: 'unavailable' }]));
        saved[D[4]] = { mode: 'before', until: '15:15' };
        await stubWithRoster(page,
            [winOver({ submission: { currentRevision: 1, days: saved } })], OVR);
        /** @type {any[]} */
        const bodies = [];
        await page.route('**/submitOvertimeAvailability', r => {
            bodies.push(JSON.parse(r.request().postData() || '{}'));
            r.fulfill({ status: 200, contentType: 'application/json',
                body: JSON.stringify({ ok: true, revision: 2, noop: false, phase: 'FINAL_OPEN', serverNow: NOW }) });
        });
        await page.goto('/overtime.html');
        const rest = page.locator(`[data-day="${D[4]}"]`);
        await rest.waitFor();
        await rest.locator('[aria-checked="true"]').click();
        await page.locator('.ot-submit').click();
        await expect(page.locator('.ot-feedback')).toContainText('submitted');
        expect(bodies[0].days[D[4]], 'the saved boundary survives the re-press')
            .toEqual({ mode: 'before', until: '15:15' });
    });

    test('a validation refusal names the day and walks there — never the connection', async ({ page }) => {
        await seedSession(page, 'G. Miller');
        await stubWithRoster(page, [winOver()], []);
        await page.route('**/submitOvertimeAvailability', r => r.fulfill({
            status: 400, contentType: 'application/json',
            body: JSON.stringify({ error: 'bad-time', date: D[3] }) }));
        await page.goto('/overtime.html');
        await page.locator('.ot-day').first().waitFor();
        for (let i = 0; i < 7; i++) {
            await page.locator('.ot-day').nth(i).getByRole('radio', { name: 'Not available' }).click();
        }
        await page.locator('.ot-submit').click();
        const feedback = page.locator('.ot-feedback');
        await expect(feedback).toContainText('Wed 2 Sep');
        await expect(feedback).not.toContainText('connection');
        // And the page walked to the day the message names — the two must agree.
        await expect(page.locator(`[data-day="${D[3]}"] .ot-mode`).first()).toBeFocused();
    });

    test('submit another week, press Back — its row now tells the truth', async ({ page }) => {
        // renderMine re-renders the week list from the window objects fetched at page load; until
        // v20.75 a successful submit never updated them, so the row for the week just submitted
        // read "Not submitted yet" seconds after the member watched it succeed.
        await seedSession(page, 'G. Miller');
        const w2 = winOver({ weekEnding: '2026-09-12', weekStart: '2026-09-06',
            finalDeadlineAt: Date.parse('2026-09-01T11:00:00Z') });
        await stubWithRoster(page, [winOver(), w2], []);
        await page.route('**/submitOvertimeAvailability', r => r.fulfill({
            status: 200, contentType: 'application/json',
            body: JSON.stringify({ ok: true, revision: 1, created: true, phase: 'FINAL_OPEN', serverNow: NOW }) }));
        await page.goto('/overtime.html');
        await page.locator('.ot-day').first().waitFor();
        await page.locator('[data-openweek="2026-09-12"]').click();
        await page.locator('.ot-day').first().waitFor();
        for (let i = 0; i < 7; i++) {
            await page.locator('.ot-day').nth(i).getByRole('radio', { name: 'Not available' }).click();
        }
        await page.locator('.ot-submit').click();
        await expect(page.locator('.ot-feedback')).toContainText('submitted');
        await page.locator('.ot-back-to-list').click();
        const row = page.locator('.ot-week-row').first();
        await expect(row).toContainText('Submitted — you can still change it');
        await expect(row).not.toContainText('Not submitted yet');
    });

    test('an overnight range says which day it belongs to', async ({ page }) => {
        // Settled by the owner, Aug 2026: a day's answer is about a duty STARTING that day. The app
        // always behaved that way — answers are keyed by date, `nextDay` is derived, and the roster
        // anchors night turns to their start day — and said so nowhere, which left an ordinary
        // entry looking self-contradictory: Friday 22:00–02:00 beside Saturday "Not available" is
        // coherent under this rule and an obvious mistake under the other. A member with no way to
        // tell which they were being asked for would reasonably enter the small hours twice.
        //
        // The hint used to read "Ends the next day" — true, and an answer to a question nobody was
        // asking.
        await seedSession(page, 'G. Miller');
        await stubWithRoster(page, [winOver()], []);
        await page.goto('/overtime.html');
        const day = page.locator(`[data-day="${D[0]}"]`);
        await day.waitFor();
        await day.getByRole('radio', { name: 'Custom times' }).click();
        await day.locator('[data-which="start"]').fill('22:00');
        await day.locator('[data-which="end"]').fill('02:00');
        await day.locator('[data-which="end"]').blur();
        const hint = day.locator('.ot-custom-hint');
        await expect(hint).toContainText('still this day\'s answer');
        // A same-day range says nothing — the rule only needs stating where it could be doubted,
        // and a hint on every custom entry would be noise that trains people past it.
        await day.locator('[data-which="end"]').fill('23:00');
        await day.locator('[data-which="end"]').blur();
        await expect(hint).toHaveText('');
    });

    test('desktop custom times sit beside the day, not under its name', async ({ page }) => {
        // The v20.74 day-row grid gave every child except .ot-custom an explicit column, so the
        // From/To inputs auto-placed bottom-left into a 190px label column. Geometry, not CSS text:
        // that is the only form the defect is visible in.
        await page.setViewportSize({ width: 1440, height: 1000 });
        await seedSession(page, 'G. Miller');
        await stubWithRoster(page, [winOver()], []);
        await page.goto('/overtime.html');
        const day = page.locator('.ot-day').first();
        await day.waitFor();
        await day.getByRole('radio', { name: 'Custom times' }).click();
        const head = await day.locator('.ot-day-head').boundingBox();
        const custom = await day.locator('.ot-custom').boundingBox();
        expect(custom.x, 'the custom row starts after the label column')
            .toBeGreaterThanOrEqual(head.x + head.width);
    });

    test('a saved form wears the saved tint, not the "about to overwrite" one', async ({ page }) => {
        // The day-row STATE GRAMMAR (v20.83) — the one borrowed from admin's Change-a-Shift week:
        // plain / gold `set` / cream `changed` / green `saved`. It had no test at all, which is how
        // the reconcile path came to be missing its repaint at v20.85: the mechanism the two paths
        // share was never pinned in either of them.
        //
        // Cream is the tint that says "you are about to overwrite something recorded". Leaving it up
        // after a successful save is the page contradicting the sentence beside it, and neither the
        // feedback assertion above nor the visual baseline (which captures an UNANSWERED form) can
        // see the difference — the words are right in both builds.
        await seedSession(page, 'G. Miller');
        const saved = Object.fromEntries(D.map(d => [d, { mode: 'unavailable' }]));
        await stubWithRoster(page, [winOver({ submission: { currentRevision: 1, days: saved } })], []);
        await page.route('**/submitOvertimeAvailability', r => r.fulfill({
            status: 200, contentType: 'application/json',
            body: JSON.stringify({ ok: true, revision: 2, noop: false, phase: 'FINAL_OPEN', serverNow: NOW }) }));
        await page.goto('/overtime.html');
        const day = page.locator(`[data-day="${D[0]}"]`);
        await day.waitFor();
        // Every row starts `saved` — the form opened on exactly what the server holds.
        await expect(page.locator('.ot-day--saved')).toHaveCount(7);
        // Change one, and only that one goes cream. `changed` and `saved` are different answers and
        // a repaint that painted the whole week either way would still satisfy a bare count.
        await day.getByRole('radio', { name: 'All day', exact: true }).click();
        await expect(day).toHaveClass(/ot-day--changed/);
        await expect(page.locator('.ot-day--saved')).toHaveCount(6);
        await page.locator('.ot-submit').click();
        await expect(page.locator('.ot-feedback')).toContainText('submitted');
        await expect(page.locator('.ot-day--changed'), 'the overwrite warning must clear on save')
            .toHaveCount(0);
        await expect(page.locator('.ot-day--saved')).toHaveCount(7);
    });

    test('a timed-out submission that DID save clears the tint too', async ({ page }) => {
        // The other half of the same mechanism, and the path that needs it most: this is the one
        // that tells somebody their form saved after they had every reason to believe it had not.
        // Until v20.85 it updated the revision and said so while leaving all seven rows cream.
        //
        // Reaching it needs the client's own 65s budget to expire — a route that never answers plus
        // a fake clock, because the budget is a constant and no lever shortens it. `install` is
        // pinned to the same instant the stubs report as `serverNow`, so the corrected clock lands
        // where the app already expects and no deadline moves under the test.
        await page.clock.install({ time: new Date(NOW) });
        await seedSession(page, 'G. Miller');
        const saved = Object.fromEntries(D.map(d => [d, { mode: 'unavailable' }]));
        const head = { currentRevision: 2, days: { ...saved, [D[0]]: { mode: 'all_day' } },
            lastMutationId: null };
        let submits = 0;
        await page.addInitScript(() => {
            window.__E2E = { ...(window.__E2E || {}), authUser: true, docs: [] };
        });
        await page.route('**/getMyOvertimeState', r => r.fulfill({
            status: 200, contentType: 'application/json',
            body: JSON.stringify({ ok: true, serverNow: NOW, windows: [{ ...W, phase: 'FINAL_OPEN',
                participant: { grade: 'CEA', rosterOrder: 2 },
                // The RE-READ carries the mutation id the client is holding, which is what makes
                // this "your earlier submission did save" rather than "it never arrived".
                submission: submits ? { ...head, lastMutationId: sentId } : { currentRevision: 1, days: saved } }] }),
        }));
        await page.route('**/getOvertimeManagerOverview', r => r.fulfill({
            status: 200, contentType: 'application/json',
            body: JSON.stringify({ ok: true, serverNow: NOW, planningWeeks: [], retained: [] }) }));
        /** @type {string} */
        let sentId = '';
        // Accept the request, record its id, and NEVER answer — exactly what a request that reaches
        // a working server on a dying connection looks like from the phone.
        await page.route('**/submitOvertimeAvailability', r => {
            submits += 1;
            sentId = JSON.parse(r.request().postData() || '{}').clientMutationId;
        });
        await page.goto('/overtime.html');
        const day = page.locator(`[data-day="${D[0]}"]`);
        await day.waitFor();
        await day.getByRole('radio', { name: 'All day', exact: true }).click();
        await expect(day).toHaveClass(/ot-day--changed/);
        await page.locator('.ot-submit').click();
        await page.clock.fastForward(70_000);            // past the 65s budget
        await expect(page.locator('.ot-feedback')).toContainText('did save');
        await expect(page.locator('.ot-day--changed'), 'told it saved, so nothing is pending')
            .toHaveCount(0);
        await expect(page.locator('.ot-day--saved')).toHaveCount(7);
    });

    test('a page re-woken near a deadline that has passed re-reads and closes the form', async ({ page }) => {
        // shouldResyncClock existed untested-in-anger since v20.69 with nothing calling it: a form
        // opened at 11:50 still said "open" at 12:05. The realistic arrival of that moment is a
        // pocketed phone re-woken, so the trigger is visibility, and the re-render happens only
        // when a phase genuinely moved — a half-filled form must not be wiped for a no-op.
        await seedSession(page, 'G. Miller');
        const nearDeadline = winOver({ finalDeadlineAt: NOW + 60_000 });   // 1 min away → in window
        let calls = 0;
        await page.addInitScript(() => { window.__E2E = { ...(window.__E2E || {}), authUser: true, docs: [] }; });
        await page.route('**/getMyOvertimeState', r => {
            calls += 1;
            const w = calls === 1 ? nearDeadline : { ...nearDeadline, phase: 'CLOSED' };
            r.fulfill({ status: 200, contentType: 'application/json',
                body: JSON.stringify({ ok: true, serverNow: NOW, windows: [w] }) });
        });
        await page.route('**/getOvertimeManagerOverview', r => r.fulfill({
            status: 200, contentType: 'application/json',
            body: JSON.stringify({ ok: true, serverNow: NOW, planningWeeks: [], retained: [] }) }));
        await page.goto('/overtime.html');
        await page.locator('.ot-day').first().waitFor();
        await expect(page.locator('.ot-submit')).toBeVisible();

        await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
        await expect(page.locator('.ot-closed-note')).toContainText('Final availability recorded');
        expect(calls).toBeGreaterThanOrEqual(2);
    });

    test('a phase move that keeps the form open does NOT wipe what is typed into it', async ({ page }) => {
        // The audit's sharpest catch, and a defect I read past: the resync reloaded on ANY phase
        // move, justified by a comment about a week that has CLOSED. INITIAL_OPEN → FINAL_OPEN
        // leaves the form fully submittable, so there the reload destroyed work for nothing — and
        // the resync window is ±5 minutes of EITHER deadline, so the initial one triggers it most.
        //
        // The realistic shape: answer five days at 11:58, pocket the phone, reopen at 12:02.
        await seedSession(page, 'G. Miller');
        const w = { ...W, phase: 'INITIAL_OPEN', participant: { grade: 'CEA', rosterOrder: 2 },
            submission: null, initialDeadlineAt: NOW + 60_000 };   // 1 min away → inside the window
        let calls = 0;
        await page.addInitScript(() => { window.__E2E = { ...(window.__E2E || {}), authUser: true, docs: [] }; });
        await page.route('**/getMyOvertimeState', r => {
            calls += 1;
            r.fulfill({ status: 200, contentType: 'application/json',
                body: JSON.stringify({ ok: true, serverNow: NOW,
                    windows: [calls === 1 ? w : { ...w, phase: 'FINAL_OPEN' }] }) });
        });
        await page.route('**/getOvertimeManagerOverview', r => r.fulfill({
            status: 200, contentType: 'application/json',
            body: JSON.stringify({ ok: true, serverNow: NOW, planningWeeks: [], retained: [] }) }));
        await page.goto('/overtime.html');
        await page.locator('.ot-day').first().waitFor();
        for (let i = 0; i < 5; i++) {
            await page.locator('.ot-day').nth(i).getByRole('radio', { name: 'Not available' }).click();
        }
        await expect(page.locator('.ot-submit')).toContainText('2 days still to answer');

        await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
        // The head TOOK the new phase — so this is not passing merely because the resync never ran.
        await expect(page.locator('.ot-form-meta')).toContainText('Answers were due');
        expect(calls, 'the server was genuinely re-read').toBeGreaterThanOrEqual(2);
        // …and the five answers are still there.
        await expect(page.locator('.ot-submit')).toContainText('2 days still to answer');
        await expect(page.locator('.ot-day--set')).toHaveCount(5);
    });

    test('leaving a form with unsubmitted answers asks first', async ({ page }) => {
        await seedSession(page, 'G. Miller');
        const w2 = winOver({ weekEnding: '2026-09-12', weekStart: '2026-09-06',
            finalDeadlineAt: Date.parse('2026-09-01T11:00:00Z') });
        await stubWithRoster(page, [winOver(), w2], []);
        await page.goto('/overtime.html');
        await page.locator('.ot-day').first().waitFor();
        await page.locator('.ot-day').first().getByRole('radio', { name: 'Not available' }).click();

        // Opening another week replaces the card. With work on the form, that has to be a question.
        await page.locator('[data-openweek="2026-09-12"]').click();
        const dialog = page.locator('.dialog-lb-content, .lb-overlay.open');
        await expect(dialog.first()).toBeVisible();
        await page.getByRole('button', { name: 'Stay on this form' }).click();
        // Staying means staying: the answer survives and the week has not changed underneath them.
        await expect(page.locator('.ot-day--set')).toHaveCount(1);
        await expect(page.locator('.ot-form-week')).toContainText('5 September 2026');
    });

    test('a clean form switches week with no question at all', async ({ page }) => {
        // The other half, and the one that decides whether the guard is usable. A confirm on every
        // navigation would train people to dismiss it, which is worse than not having one.
        await seedSession(page, 'G. Miller');
        const w2 = winOver({ weekEnding: '2026-09-12', weekStart: '2026-09-06',
            finalDeadlineAt: Date.parse('2026-09-01T11:00:00Z') });
        await stubWithRoster(page, [winOver(), w2], []);
        await page.goto('/overtime.html');
        await page.locator('.ot-day').first().waitFor();
        await page.locator('[data-openweek="2026-09-12"]').click();
        await expect(page.locator('.ot-form-week')).toContainText('12 September 2026');
    });

    test('the reviewer sees what each person is ROSTERED to work, beside what they offered', async ({ page }) => {
        // The rules are unit-tested; only a browser answers whether the roster read actually
        // REACHES the workspace — it is a second Firestore query, threaded through loadWeekDetail
        // and two render layers, and every one of those hops fails silently by rendering nothing.
        //
        // The participant is a REAL roster member, and that is load-bearing: `loadRosterForMembers`
        // resolves the base roster from `teamMembers`, so a fixture name resolves to nothing and
        // renders the honest "Roster unavailable" — which a bare "is there a roster cell?" assertion
        // would happily accept from a build where the read is not wired at all. (First pass of this
        // test did exactly that, and survived the mutation.) With a real name the cell must contain
        // a real shift chip.
        await seedSession(page, 'H. Croft');
        await page.addInitScript((rows) => {
            window.__E2E = { ...(window.__E2E || {}), authUser: true, docs: rows };
        }, [{ id: 'G. Miller', memberName: 'G. Miller', grade: 'CEA', rosterOrder: 1 }]);
        await page.route('**/getMyOvertimeState', r => r.fulfill({
            status: 200, contentType: 'application/json',
            body: JSON.stringify({ ok: true, serverNow: NOW, windows: [] }) }));
        await page.route('**/getOvertimeManagerOverview', r => r.fulfill({
            status: 200, contentType: 'application/json',
            body: JSON.stringify({ ok: true, serverNow: NOW,
                planningWeeks: [{ ...W, exists: true, state: 'created', canCreate: false,
                    expected: 1, received: 1, noResponse: 0 }], retained: [] }) }));
        await page.goto('/overtime.html');
        await page.locator('.ot-day-panel').first().waitFor();
        const rosters = page.locator('.ot-person-roster');
        expect(await rosters.count(), 'no roster cell at all means the row never got one')
            .toBeGreaterThan(0);
        // The app's OWN shift chip, resolved through the shared ladder — not the "Roster
        // unavailable" placeholder, which is what an unwired read produces and which looks
        // identical to a working one at the level of "is there a cell here".
        await expect(page.locator('.ot-person-roster .shift-badge').first()).toBeVisible();
        await expect(page.locator('.ot-person-roster').filter({ hasText: 'Roster unavailable' }))
            .toHaveCount(0);
        // And the screen reader gets the word that says what the chip IS.
        await expect(rosters.first()).toContainText('Rostered:');
    });

    test('the reviewer\'s day pick survives a grade switch', async ({ page }) => {
        // Both lenses re-render from one state now. Before, the grade repaint reset the day to All
        // week — a clerk reading Saturday's CEAs who tapped CES was bounced to the full week.
        await seedSession(page, 'H. Croft');
        await page.addInitScript((rows) => {
            window.__E2E = { ...(window.__E2E || {}), authUser: true, docs: rows };
        }, [
            { id: 'A. One', memberName: 'A. One', grade: 'CEA', rosterOrder: 1 },
            { id: 'B. Two', memberName: 'B. Two', grade: 'CES', rosterOrder: 2 },
        ]);
        await page.route('**/getMyOvertimeState', r => r.fulfill({
            status: 200, contentType: 'application/json',
            body: JSON.stringify({ ok: true, serverNow: NOW, windows: [] }) }));
        await page.route('**/getOvertimeManagerOverview', r => r.fulfill({
            status: 200, contentType: 'application/json',
            body: JSON.stringify({ ok: true, serverNow: NOW,
                planningWeeks: [{ ...W, exists: true, state: 'created', canCreate: false,
                    expected: 2, received: 2, noResponse: 0 }], retained: [] }) }));
        await page.goto('/overtime.html');
        await page.locator('.ot-day-panel').first().waitFor();

        const shownDays = () => page.locator('.ot-day-panel[data-date]').evaluateAll(els =>
            els.filter(e => getComputedStyle(e).display !== 'none').length);
        await page.locator('[data-glance]').nth(2).click();
        expect(await shownDays()).toBe(1);
        await page.locator('[data-grade="CEA"]').click();
        expect(await shownDays(), 'the grade switch keeps the picked day').toBe(1);
        await expect(page.locator('[data-glance]').nth(2)).toHaveAttribute('aria-pressed', 'true');
    });
});

test.describe('the beta PARTICIPANT — a form of her own, and nothing of anybody else\'s', () => {
    // The first ordinary member invited into the beta (v20.76). Two audiences reach one page and
    // must not converge: she answers for herself; a reviewer sees everyone. Before this, the page
    // had only the reviewer answer — the pill was reviewer-gated and the page policy demanded an
    // admin/manager role — so a member the SERVER was already asking would have found no link in
    // the drawer and a "not open to everyone yet" panel if she typed the URL.
    const BETA = 'T. Bibi';

    test('she gets her own form, and no way to see anyone else\'s', async ({ page }) => {
        await seedSession(page, BETA);
        // The reviewer endpoint is stubbed to FAIL, the way the real one 403s for a non-reviewer:
        // if the page ever tried to build the workspace, this is what it would get.
        await page.addInitScript(() => { window.__E2E = { ...(window.__E2E || {}), authUser: true, docs: [] }; });
        await page.route('**/getMyOvertimeState', r => r.fulfill({
            status: 200, contentType: 'application/json',
            body: JSON.stringify({ ok: true, serverNow: NOW, windows: [openWindow()] }) }));
        await page.route('**/getOvertimeManagerOverview', r => r.fulfill({
            status: 403, contentType: 'application/json',
            body: JSON.stringify({ error: 'Forbidden — reviewer access required' }) }));

        await page.goto('/overtime.html');
        await expect(page.locator('.ot-day')).toHaveCount(7);
        // No tab strip: a strip with one tab is a door to a room that is not there.
        await expect(page.locator('#otTabs')).toBeHidden();
        await expect(page.locator('#otAllPanel')).toBeHidden();
        // The reviewer's surface is static markup on every copy of this page, so the question is
        // whether it SHOWS, not whether it exists — `toHaveCount(0)` asserted the wrong thing and
        // failed on correct code. What must be true is that nothing of it is visible, and that no
        // colleague's row was ever built: the horizon read is never even attempted for her.
        await expect(page.locator('#otHorizonCard')).toBeHidden();
        await expect(page.locator('.ot-person')).toHaveCount(0);
    });

    test('and she can REACH it — the drawer offers the pill from another page', async ({ page }) => {
        // The half that no amount of page-level correctness supplies. `canOpenOvertime` is passed by
        // all seven coordinators; page-contract-parity pins that, and this proves the outcome.
        await seedSession(page, BETA);
        await page.goto('/settings.html');
        await page.locator('#navMenuBtn').click();
        await expect(page.locator('.nav-panel-pill--overtime')).toBeVisible();
    });

    test('an ordinary member gets neither the pill nor the page', async ({ page }) => {
        await seedSession(page, 'S. Silva');
        await page.goto('/settings.html');
        await page.locator('#navMenuBtn').click();
        await expect(page.locator('.nav-panel-pill--overtime')).toHaveCount(0);

        await page.goto('/overtime.html');
        await expect(page.locator('#otMineContent')).toContainText("isn't open to everyone yet");
        await expect(page.locator('.ot-day')).toHaveCount(0);
    });
});

test('the availability options meet the app\'s touch target', async ({ page }) => {
    // These are the most-tapped controls in the app — seven days, up to six options each, and
    // answering one week means hitting them seven times on a phone. They are a deliberate copy of
    // admin's `.type-pill-btn` (same border, radius, weight and --type-badge), and that rule
    // carries `min-height: 44px`; this one shipped at 36px, so the single page built entirely out
    // of these pills was the one page below the standard. Measured in a browser rather than read
    // off the CSS: a min-height is only the floor, and padding or line-height could undercut it.
    await page.setViewportSize({ width: 390, height: 844 });
    await seedSession(page, 'G. Miller');
    await stubOvertime(page, { windows: [openWindow()] });
    await page.goto('/overtime.html');
    await page.locator('.ot-day').first().waitFor();

    const short = await page.locator('.ot-mode').evaluateAll(els => els
        .map(el => ({ t: el.textContent.trim(), h: Math.round(el.getBoundingClientRect().height) }))
        .filter(x => x.h < 44));
    expect(short, 'every availability option must be at least 44px tall').toEqual([]);
});

test.describe('an invitation that lands after the week was made', () => {
    // Reported live: a member added to the beta was told "no forms are open for you" while the
    // admin's were open. Populations are frozen at creation, and the scheduler pre-creates eight
    // weeks — so by the time anybody is invited, every week they could usefully answer already
    // exists and the invitation reaches none of them.

    test('the reviewer is TOLD, and can add them on the spot', async ({ page }) => {
        await seedSession(page, 'H. Croft');
        await page.addInitScript(() => { window.__E2E = { ...(window.__E2E || {}), authUser: true, docs: [] }; });
        await page.route('**/getMyOvertimeState', r => r.fulfill({ status: 200, contentType: 'application/json',
            body: JSON.stringify({ ok: true, serverNow: NOW, windows: [] }) }));

        // First load: one participant frozen in, but the audience now selects two.
        let loads = 0;
        await page.route('**/getOvertimeManagerOverview', r => {
            loads += 1;
            const row = { ...W, exists: true, state: 'created', canCreate: false,
                expected: loads === 1 ? 1 : 2, received: 1, noResponse: 0,
                audienceCount: 2 };
            r.fulfill({ status: 200, contentType: 'application/json',
                body: JSON.stringify({ ok: true, serverNow: NOW, planningWeeks: [row], retained: [] }) });
        });
        /** @type {any[]} */
        const posted = [];
        await page.route('**/createOvertimeWindow', r => {
            posted.push(JSON.parse(r.request().postData() || '{}'));
            r.fulfill({ status: 200, contentType: 'application/json',
                body: JSON.stringify({ ok: true, existed: true, added: ['T. Bibi'], window: W }) });
        });

        await page.goto('/overtime.html');
        const add = page.getByRole('button', { name: 'Add 1' });
        await expect(add, 'the row says the audience has outgrown the week').toBeVisible();

        await add.click();
        await expect(page.locator('#otConfirmText')).toContainText('T. Bibi');
        // It goes through the CREATE endpoint with dryRun false — one server path, so the button
        // and the nightly job can never disagree about who is in a week's audience.
        expect(posted[0]).toEqual({ weekEnding: W.weekEnding, dryRun: false });
        // And the row stops offering it once the population has caught up.
        await expect(page.getByRole('button', { name: 'Add 1' })).toHaveCount(0);
    });

    test('a week whose population already matches offers nothing', async ({ page }) => {
        await seedSession(page, 'H. Croft');
        await stubOvertime(page, { weeks: [{ ...W, exists: true, state: 'created', canCreate: false,
            expected: 2, received: 2, noResponse: 0, audienceCount: 2 }] });
        await page.goto('/overtime.html');
        await expect(page.locator('.ot-week-row')).toHaveCount(1);
        await expect(page.locator('[data-topup]'), 'nothing to add, so no control').toHaveCount(0);
    });

    test('a CLOSED week never offers it, however far the audience has moved', async ({ page }) => {
        // The server sends `audienceCount: null` for a closed week precisely so this cannot be
        // offered: adding somebody who could never have answered would create a permanent false
        // non-responder. The client must not invent the control from the counts alone.
        await seedSession(page, 'H. Croft');
        await stubOvertime(page, { weeks: [{ ...W, exists: true, state: 'created-closed', canCreate: false,
            expected: 1, received: 1, noResponse: 0, audienceCount: null }] });
        await page.goto('/overtime.html');
        await expect(page.locator('.ot-week-row')).toHaveCount(1);
        await expect(page.locator('[data-topup]')).toHaveCount(0);
    });
});
