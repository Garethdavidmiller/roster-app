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

    test('answering a day marks it, and the button counts down', async ({ page }) => {
        await seedSession(page, 'G. Miller');
        await stubOvertime(page, { windows: [openWindow()] });
        await page.goto('/overtime.html');
        await page.locator('.ot-day').first().getByRole('button', { name: 'Not available' }).click();
        await expect(page.locator('.ot-day--answered')).toHaveCount(1);
        await expect(page.locator('.ot-submit')).toContainText('6 days still to answer');
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
        await expect(page.locator('#otHorizonContent')).toContainText('no availability window was created');
        await expect(page.locator('#otHorizonChip')).toContainText('5 without a form');
    });

    test('a missed week offers no Create; a recoverable one does', async ({ page }) => {
        await seedSession(page, 'H. Croft');
        await stubOvertime(page, { weeks: sixWeeks() });
        await page.goto('/overtime.html');
        const missed = page.locator('.ot-week-row').first();
        await expect(missed).toContainText('Missed');
        await expect(missed.getByRole('button')).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Create' })).toHaveCount(4);
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

    test('hidden really hides — the confirm bar is not on screen at rest', async ({ page }) => {
        // `display: flex` out-specifies the `hidden` attribute, so this bar covered the bottom of
        // every page view until its companion rule was added. A fixed element, so it was not subtle.
        await seedSession(page, 'H. Croft');
        await stubOvertime(page, { weeks: sixWeeks() });
        await page.goto('/overtime.html');
        await expect(page.locator('#otConfirmBar')).toBeHidden();
    });
});
