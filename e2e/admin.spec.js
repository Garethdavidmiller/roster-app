/**
 * admin.spec.js — Admin (admin.html): the week grid, leave and absence booking, Saved Changes, the roster import review.
 *
 * Split out of pages.spec.js on 3 Nov 2026, test for test and unchanged: the tests that span
 * pages, and the shared drawer, dialogs and sheets, stay there.
 */
import { test, expect } from './fixtures.js';
import { collectFatalErrors, seedSession, seedSessionOnce, seedMember, clickInView, seedMemberSession, isTouchProject, scaleText, waitForReadsToLand } from './helpers.js';
import { SUNDAY_FORBIDDEN_TYPES } from '../override-utils.js';
import { teamMembers, getBaseShift } from '../roster-data.js';

// Admin signed out BEFORE asking about unsaved week-grid edits (v24.52, page-session.js): the drawer
// released the session and the push record, and only the reload that followed met `beforeunload` —
// which a phone suppresses, so the edits went without a word. It now asks first, like Links.
/** @param {import('@playwright/test').Page} page */
async function adminWithUnsavedEditAtSignOut(page) {
    await page.addInitScript(() => { /** @type {any} */ (window).__E2E = { authUser: true, docs: [] }; });
    await seedSessionOnce(page, 'G. Miller');   // once: the sign-out's reload must not re-seed it
    await page.goto('/admin.html');
    await page.evaluate(() => localStorage.setItem('myb_push_resave_at', '12345'));
    await clickInView(page.locator('.day-row .type-pill-btn[data-type="annual_leave"]:not([disabled])').first());
    await page.locator('#navMenuBtn').click();
    await page.locator('#navSignOutBtn').click();
    const dialog = page.locator('.dialog-overlay').last();
    await expect(dialog).toContainText('Sign out anyway?');
    return dialog;
}

test('admin: signing out with unsaved edits asks first, and a Cancel keeps the session and the push record', async ({ page }) => {
    const dialog = await adminWithUnsavedEditAtSignOut(page);
    await dialog.locator('.dialog-btn-cancel').click();
    await expect(page.locator('.dialog-overlay')).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('myb_admin_session')),
        'a declined sign-out must leave the session').not.toBeNull();
    expect(await page.evaluate(() => localStorage.getItem('myb_push_resave_at')),
        'a declined sign-out must not have released the push record').toBe('12345');
    // …and no ghost: the drawer's history entry was popped, not abandoned, so the member's next
    // Android Back is not swallowed by an entry that no longer has anything to close (v24.53).
    expect(await page.evaluate(() => history.state?.mybNavPanel ?? null),
        'a cancelled sign-out must not leave the drawer\'s history entry behind').toBeNull();
});

test('admin: answering "Sign out" to the unsaved-edits question signs out', async ({ page }) => {
    // Runs under WebKit too since v24.53. Until then it was skipped there: Playwright's WebKit build
    // crashed the page on any navigation once the drawer had left its history entry behind and a
    // dialog had pushed and popped another. The drawer now pops its own entry before asking.
    const dialog = await adminWithUnsavedEditAtSignOut(page);
    await dialog.locator('.dialog-btn-confirm').click();
    await expect(page.locator('#loginOverlay')).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('myb_admin_session')),
        'an answered sign-out clears the session').toBeNull();
});

// ── ADMIN TOUCH LAYOUT — no horizontal blowout when a pill with hours is selected ──
// Regression: on TOUCH devices (pointer: coarse) the bulk-bar time inputs' intrinsic
// min-width (~180px each, unshrinkable without min-width: 0) stretched the whole page
// to ~585px inside a ~393px viewport the moment a pill with hours (Shift/RDW/Other)
// was selected — clipping the header, member bar, and every card at the right edge.
// Desktop never showed it (the coarse-pointer stylesheet block doesn't apply), which
// is why this must assert element widths on the Pixel-5 project, not desktop.
test('a tips panel with more below the fold says so, and stops saying it at the bottom', async ({ page }) => {
    // The fade is a MASK on a scroll container: it appears in no screenshot the suite takes (no
    // baseline captures a scrolling panel), it changes no text, and no behavioural test could
    // notice it. So the one thing that can go wrong silently — the class never being applied, or
    // never being cleared — is pinned here, in the suite that runs on every branch.
    //
    // Change a Shift is the right panel: at 390px it is ~1,100px of content in a 765px box, and it
    // is the panel a member is most likely to be reading when they need the part below the fold.
    await seedSession(page, 'G. Miller');
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto('/admin.html');
    await page.locator('.btn-card-tips').first().click();

    const panel = page.locator('#tipsLightboxContent');
    await expect(panel).toBeVisible();
    // PREMISE: this panel really does overflow. Without it the assertion below would pass happily
    // on a panel that fits, which is the same test passing for the opposite reason.
    await expect.poll(async () => panel.evaluate(el => el.scrollHeight - el.clientHeight),
        { message: 'premise: the Change a Shift tips panel overflows at 390px' })
        .toBeGreaterThan(2);
    await expect(panel).toHaveClass(/\bhas-more\b/);

    await panel.evaluate(el => { el.scrollTop = el.scrollHeight; });
    // And it goes once there is nothing more to read — a fade that never clears is a panel that
    // always claims to be hiding something.
    await expect(panel).not.toHaveClass(/\bhas-more\b/);
});

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

    // The save re-reads the day from the server first; seeded only now, so nothing else reads it.
    await page.evaluate((rec) => { /** @type {any} */ (window).__E2E.getDocData = rec; }, REC);
    await y2026.click();
    await expect(y2026).toHaveAttribute('aria-pressed', 'true');
    await expect(figures).toHaveText('2026: 31 days left · 2027: 32 days left');
    await expect(page.locator('#alLeaveYearFeedback')).toContainText('now comes out of 2026’s allowance');
    const moved = await page.evaluate(() => /** @type {any} */ (window).__E2E.batchWrites.at(-1));
    expect(moved).toMatchObject({ date: DAY, type: 'annual_leave', value: 'AL', leaveYear: 2026, source: 'manual', changedBy: 'G. Miller' });

});

// The way back, from a fresh load of a day already moved — the stub's `doc()` mints no id, so a
// second save on the same page would see its own first write as a record it never loaded and be
// (rightly) refused. Real Firestore refs carry their id; the stale-page refusal is unit-tested.
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
    await page.evaluate((rec) => { /** @type {any} */ (window).__E2E.getDocData = rec; }, MOVED);
    await y2027.click();
    await expect(y2027).toHaveAttribute('aria-pressed', 'true');
    await expect(panel.locator('.ly-figures')).toHaveText('2026: 32 days left · 2027: 31 days left');
    const back = await page.evaluate(() => /** @type {any} */ (window).__E2E.batchWrites.at(-1));
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

// ── THE WEEK GRID'S TIME BOXES, TYPED (admin-time-inputs.js, v24.64) ──────────────────────────
// Nothing drove these before: the formatting, the focus move and the blur check were wired in the
// editor and no spec typed into them. The keypad an iPhone shows for `inputmode="numeric"` has no
// colon, so if the formatter stops running a time cannot be entered from a phone at all.
test('admin: a week-grid time box formats as typed, moves on, and flags an impossible time', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-08-27T09:00:00Z'));
    await seedSession(page, 'G. Miller');
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    const row = page.locator('.day-row').filter({ has: page.locator('.type-pill-btn[data-type="shift"]:not([disabled])') }).first();
    await clickInView(row.locator('.type-pill-btn[data-type="shift"]'));
    const start = row.locator('.day-start');
    const end = row.locator('.day-end');
    await start.fill('');
    await start.pressSequentially('630');
    await expect(start, 'three digits whose first pair is not an hour read as a dropped zero').toHaveValue('06:30');
    await expect(end, 'a complete start moves on to the end').toBeFocused();
    await end.fill('');   // prefilled with the rostered finish, and the box holds five characters
    await end.pressSequentially('1975');
    await expect(end).toHaveValue('19:75');
    await start.focus();   // leave the box — the HH:MM check runs on blur
    await expect(end).toHaveClass(/\binput-error\b/);
    await expect(end).toHaveAttribute('aria-invalid', 'true');
    await end.fill('');
    await end.pressSequentially('1400');
    await expect(end).toHaveValue('14:00');
    await expect(end, 'typing again clears the error').not.toHaveAttribute('aria-invalid', 'true');
    // A MIDNIGHT FINISH TYPED AS 2400 (whole-app review, Oct 2026). The box reshaped "240" into
    // 02:40 — five characters, a full box — so the last 0 was never typed and 02:40 was saved. Typed
    // key by key, it now reads 24:00 and is refused; three digits are a dropped zero only once the
    // box is left.
    await end.fill('');
    await end.pressSequentially('2400');
    await expect(end).toHaveValue('24:00');
    await start.focus();
    await expect(end, 'midnight is written 00:00; 24:00 is refused, never saved as something else').toHaveClass(/\binput-error\b/);
    await end.fill('');
    await end.pressSequentially('240');
    await expect(end, 'still typing: it may yet be 2400').toHaveValue('24:0');
    await start.focus();
    await expect(end, 'left as three digits, it is a dropped zero').toHaveValue('02:40');
    await expect(end).not.toHaveClass(/\binput-error\b/);
});

// ── LEAVING ADMIN BY THE DRAWER OR THE LOGO ASKS FIRST (whole-app review, Oct 2026) ────────────
// Only the browser's own unload prompt guarded those exits, and a phone never shows it, so staged
// rows were discarded without a word. The drawer asks in a dialog (the page's banner would sit under
// the drawer's scrim); the logo goes through the same banner as every other exit on the page.
/** Open Admin on a FUTURE week (Mon 7 Dec 2026). The Calendar drops a stored future month, so only
 *  the Calendar pill's `?date=` can get a member there (whole-app review, B3). The MEMBER seeder,
 *  because the Calendar's gate shows a sign-in card to a session with no identity behind it.
 *  @param {import('@playwright/test').Page} page */
async function openAdminOnDecember(page) {
    await page.clock.setFixedTime(new Date('2026-08-27T09:00:00Z'));
    await seedMemberSession(page, 'G. Miller');
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    await page.locator('#fieldDate').evaluate((el) => {
        /** @type {HTMLInputElement} */ (el).value = '2026-12-07';       // Monday
        el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect(page.locator('#weekNavLabel')).toContainText('Dec 2026');
}

// THE DIALOG OVER THE DRAWER OWNS THE KEYBOARD (v25.06, whole-app review). The drawer's own keydown
// handler had no topmost check, so with "Leave this page anyway?" open over it, Tab dragged focus into
// the drawer behind the modal and a single Escape closed BOTH — two surfaces, two history steps.
test('admin: with the leave question open over the drawer, Tab stays in it and Escape closes only it', async ({ page }) => {
    await openAdminOnDecember(page);
    const row = page.locator('.day-row').filter({ has: page.locator('.type-pill-btn[data-type="shift"]:not([disabled])') }).first();
    await clickInView(row.locator('.type-pill-btn[data-type="shift"]'));
    await row.locator('.day-start').fill('06:00');
    await row.locator('.day-end').fill('14:00');
    await page.locator('#navMenuBtn').click();
    await page.locator('.nav-panel-pill--calendar').click();
    await expect(page.getByText('You have unsaved changes. Leave this page anyway?')).toBeVisible();
    // The dialog is VISIBLE a frame before it takes focus (createLightbox focuses on the next
    // animation frame), so a Tab pressed the instant it shows can still start from the drawer's pill.
    // No person is that quick, and Playwright 1.64 on the phone project was (4 Nov 2026): wait for
    // the focus first, which is also the WAI-ARIA half of the contract.
    await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('.dialog-overlay')),
        'the dialog takes focus as it opens').toBe(true);
    for (let i = 0; i < 3; i++) {
        await page.keyboard.press('Tab');
        expect(await page.evaluate(() => !!document.activeElement?.closest('.dialog-overlay')), 'Tab must stay inside the dialog').toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(page.getByText('You have unsaved changes. Leave this page anyway?')).toBeHidden();
    await expect(page.locator('#navPanel'), 'one Escape closes the topmost surface only').toHaveClass(/open/);
    await expect(page).toHaveURL(/admin\.html/);
    // A closed dialog stays in the page for 500ms so it can fade, and the next question builds a new
    // one; ask again before it has gone and the page holds two copies of the same words.
    await expect(page.locator('.dialog-overlay'), 'the closed dialog has left the page').toHaveCount(0);
    // A hardware Back is the same rule: it closes the dialog, not the drawer beneath it.
    // Each step waits for the history it depends on rather than 400ms (test audit, 7 Nov 2026): first the
    // closed dialog's Back echo, so the next question's entry is not the one it pops…
    const overlayEntry = () => page.evaluate(() => history.state?.mybOverlay ?? null);
    await expect.poll(overlayEntry, { message: 'the closed dialog\'s history entry has gone' }).toBeNull();
    await page.locator('.nav-panel-pill--calendar').click();
    await expect(page.getByText('You have unsaved changes. Leave this page anyway?')).toBeVisible();
    // …then the new dialog's own entry, which is what a Back is meant to close.
    await expect.poll(overlayEntry, { message: 'the dialog holds the top history entry' }).toBe(true);
    await page.evaluate(() => history.back());
    await expect(page.getByText('You have unsaved changes. Leave this page anyway?')).toBeHidden();
    await expect(page.locator('#navPanel'), 'Back closes the topmost surface only').toHaveClass(/open/);
    await expect(page).toHaveURL(/admin\.html/);
});

test('admin: a drawer pill or the logo asks before leaving staged edits', async ({ page }) => {
    await openAdminOnDecember(page);
    const row = page.locator('.day-row').filter({ has: page.locator('.type-pill-btn[data-type="shift"]:not([disabled])') }).first();
    await clickInView(row.locator('.type-pill-btn[data-type="shift"]'));
    await row.locator('.day-start').fill('06:00');
    await row.locator('.day-end').fill('14:00');

    // The drawer: asked, and Cancel keeps the page and the edit.
    await page.locator('#navMenuBtn').click();
    await page.locator('.nav-panel-pill--calendar').click();
    await expect(page.getByText('You have unsaved changes. Leave this page anyway?')).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page, 'Cancel must keep the page').toHaveURL(/admin\.html/);
    await expect(row.locator('.day-start')).toHaveValue('06:00');

    // The logo: the page's own banner, and "Keep editing" keeps it.
    await page.keyboard.press('Escape');
    await page.locator('#appIcon').click();
    await expect(page.locator('#unsavedBanner')).toBeVisible();
    await page.locator('#unsavedKeepBtn').click();
    await expect(page).toHaveURL(/admin\.html/);

    // Leave, from the drawer, runs the pill's own work too: the navigation it starts names the
    // edited month.
    //
    // STOPPED AT THE NETWORK, ON PURPOSE (v24.97). Playwright 1.56's WebKit crashed its web process
    // on any cross-document navigation made after two pushState calls and a history.back(), and this
    // flow is exactly that: the drawer's entry, the dialog's entry, the dialog closing. Four lines
    // with nothing of the app in them crashed it the same way, on both WebKit projects, here and on
    // CI. Playwright 1.63's WebKit (2359) does not — re-run 3 Nov 2026, three out of three
    // (KNOWN_LIMITATIONS.md → "Playwright's WebKit crashed"). The stop stays because it is right on
    // either build: the Calendar is answered 204 No Content, which every browser treats as "stay on
    // this page", and the test reads what Leave asked for. Whether the Calendar honours the month is
    // the next test, which opens it without a dialog.
    //
    // THE LEAVE CLICK DOES NOT WAIT FOR ITS NAVIGATION (6 Nov 2026). Playwright's click, once it has
    // clicked, waits for the navigation it started to load or be cancelled, and the 204 cancels it
    // without Chromium always saying so: the click then sat on "waiting for scheduled navigations to
    // finish" until the test's 30 seconds ran out, on both attempts of one CI run and about one local
    // run in five, with the request it started already caught and answered. What this test checks is
    // that request, read below, so the click is told not to wait (`noWaitAfter`).
    const leaving = page.waitForRequest((req) => req.isNavigationRequest() && !req.url().includes('admin.html'));
    await page.route((url) => url.pathname === '/', (route) => route.fulfill({ status: 204 }));
    await page.locator('#navMenuBtn').click();
    await page.locator('.nav-panel-pill--calendar').click();
    await page.getByRole('button', { name: 'Leave', exact: true }).click({ noWaitAfter: true });
    const to = new URL((await leaving).url());
    expect(to.pathname, 'Leave goes to the Calendar').toBe('/');
    expect(to.searchParams.get('date'), 'Leave runs the pill’s own work: the link names the month being edited').toBe('2026-12-07');
});

// ── ADMIN'S CALENDAR PILL OPENS THE MONTH BEING EDITED, A FUTURE ONE INCLUDED (whole-app review, B3) ──
// The pill used to store the month and leave the link bare, and the Calendar drops a stored future
// month, so December became August. No staged edits here, so no dialog: the test above proves Leave
// goes through this same pill.
test('admin: the Calendar pill opens the Calendar on the month being edited, a future one included', async ({ page }) => {
    await openAdminOnDecember(page);
    await page.locator('#navMenuBtn').click();
    await page.locator('.nav-panel-pill--calendar').click();
    // Wait for the Calendar to ARRIVE, not merely for the address to change: ending on the first
    // frame of the navigation tore the page down under a request still in flight, and failed a run.
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    await expect(page.locator('.month-year').first()).toContainText('December');
});

// ── THE ABOUT PANEL'S LINKS ASK TOO (iPhone audit, Nov 2026) ─────────────────────────────────────
// "View staff roster" and "Staff & Admin Guide" sit in the About panel (#iconLightbox), outside the
// drawer, and the in-page question looked for drawer links alone — so on an iPhone, where the browser
// never asks, either one left staged rows behind without a word. Report a bug is mail, and leaves
// nothing behind, so it never asks.
test('admin: with staged edits, the About panel\'s links ask before leaving — Report a bug never does', async ({ page }) => {
    await openAdminOnDecember(page);
    const row = page.locator('.day-row').filter({ has: page.locator('.type-pill-btn[data-type="shift"]:not([disabled])') }).first();
    await clickInView(row.locator('.type-pill-btn[data-type="shift"]'));
    await row.locator('.day-start').fill('06:00');
    await row.locator('.day-end').fill('14:00');
    await page.locator('#navMenuBtn').click();
    await page.locator('#navPanelBrand').click();
    const about = page.locator('#iconLightbox');
    await expect(about).toBeVisible();

    // Report a bug: no question. The mail app is kept shut and the tap is recorded as having arrived.
    await page.locator('#adminBugReportLink').evaluate((el) => el.addEventListener('click', (e) => {
        e.preventDefault(); /** @type {any} */ (window).__bugTapped = true;
    }));
    await page.locator('#adminBugReportLink').click();
    expect(await page.evaluate(() => /** @type {any} */ (window).__bugTapped), 'the tap reached the link').toBe(true);
    await expect(page.locator('.dialog-overlay'), 'mail leaves the page where it is').toHaveCount(0);

    // View staff roster: asked, and Cancel keeps the page and the edit.
    const question = page.getByText('You have unsaved changes. Leave this page anyway?');
    await about.getByRole('link', { name: 'View staff roster' }).click();
    await expect(question).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(question).toBeHidden();
    await expect(page, 'Cancel must keep the page').toHaveURL(/admin\.html/);
    await expect(row.locator('.day-start')).toHaveValue('06:00');

    // Leave goes — stopped at the network and read from the request, as the drawer test above does.
    const leaving = page.waitForRequest((req) => req.isNavigationRequest() && !req.url().includes('admin.html'));
    await page.route((url) => url.pathname === '/', (route) => route.fulfill({ status: 204 }));
    await about.getByRole('link', { name: 'View staff roster' }).click();
    await page.getByRole('button', { name: 'Leave', exact: true }).click({ noWaitAfter: true });
    expect(new URL((await leaving).url()).pathname, 'Leave follows the link').toBe('/');
});

// ── STAGED ROWS OUTLIVE THE PAGE (iPhone audit, Nov 2026) ────────────────────────────────────────
// iOS discards a page it has put in the background, and a swipe back asks nothing, so the staged rows
// are kept whenever the page is hidden and offered on the next load — to the same member only, and
// never put back without asking (unsaved-draft.js). Driven through a real hide, the state and then
// the event as iOS sends them, and a real reload.
/** @param {import('@playwright/test').Page} page @param {'hidden'|'visible'} state */
async function setVisibility(page, state) {
    await page.evaluate((s) => {
        Object.defineProperty(document, 'visibilityState', { value: s, configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
    }, state);
}
/** Reload past the browser's own "Leave site?", which the staged rows arm on a desktop engine.
 *  @param {import('@playwright/test').Page} page */
async function reloadPastLeaveSite(page) {
    const accept = (/** @type {import('@playwright/test').Dialog} */ d) => d.accept().catch(() => {});
    page.on('dialog', accept);
    await page.reload();
    page.off('dialog', accept);
}
const ADMIN_DRAFT = 'myb_draft_admin_G.%20Miller';

/** Mark a December weekday Absent, hide the page, and return that day and the time the offer names.
 *  @param {import('@playwright/test').Page} page */
async function stageAbsenceAndHide(page) {
    await openAdminOnDecember(page);
    const row = page.locator('.day-row').filter({ has: page.locator('.type-pill-btn[data-type="sick"]:not([disabled])') }).first();
    const date = /** @type {string} */ (await row.getAttribute('data-date'));
    await clickInView(row.locator('.type-pill-btn[data-type="sick"]'));
    await expect(page.locator('#saveBtn')).toBeEnabled();
    await setVisibility(page, 'hidden');
    const kept = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), ADMIN_DRAFT);
    expect(kept?.scope, 'hidden with a staged row: the member and the week are kept').toEqual({ member: 'G. Miller', date: '2026-12-07' });
    expect(kept?.data?.rows).toEqual([expect.objectContaining({ date, type: 'sick', was: '' })]);
    const clock = await page.evaluate(() => new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }));
    return { date, clock };
}

test('admin: staged rows kept when the page was hidden are offered on the next load, and Restore puts them back on their week', async ({ page }) => {
    const { date, clock } = await stageAbsenceAndHide(page);
    await reloadPastLeaveSite(page);
    const offer = page.locator('.dialog-overlay.visible');
    await expect(offer).toContainText(`Restore your unsaved changes from ${clock}?`);
    // The page opened on this week, not December: Restore takes the grid to the week the rows are for.
    await expect(page.locator('#weekNavLabel')).toContainText('Aug 2026');
    await offer.getByRole('button', { name: 'Restore' }).click();
    await expect(page.locator('#weekNavLabel')).toContainText('Dec 2026');
    await expect(page.locator(`.day-row[data-date="${date}"] .type-pill-btn[data-type="sick"]`)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#saveBtn'), 'back as UNSAVED work, for the member to check and save').toBeEnabled();
    await expect(page.locator('#formFeedback')).toContainText('Your unsaved changes are back — check them, then select Save changes.');
    expect(await page.evaluate((k) => localStorage.getItem(k), ADMIN_DRAFT), 'cleared once it is the page\'s work again').toBeNull();
    // And a save clears it for good: the next hide, with nothing unsaved, keeps nothing.
    await page.locator('#saveBtn').click();
    await expect(page.locator('#formFeedback')).toContainText('1 change saved for G. Miller', { timeout: 10000 });
    await setVisibility(page, 'hidden');
    expect(await page.evaluate((k) => localStorage.getItem(k), ADMIN_DRAFT), 'saved: nothing to keep').toBeNull();
});

test('admin: Discard deletes the kept rows, changes nothing, and the next load asks nothing', async ({ page }) => {
    const { clock } = await stageAbsenceAndHide(page);
    await reloadPastLeaveSite(page);
    const offer = page.locator('.dialog-overlay.visible');
    await expect(offer).toContainText(`Restore your unsaved changes from ${clock}?`);
    await offer.getByRole('button', { name: 'Discard' }).click();
    await expect(page.locator('.dialog-overlay')).toHaveCount(0);
    await expect(page.locator('#weekNavLabel'), 'nothing moved').toContainText('Aug 2026');
    await expect(page.locator('#saveBtn'), 'nothing staged').toBeDisabled();
    expect(await page.evaluate((k) => localStorage.getItem(k), ADMIN_DRAFT)).toBeNull();
    await page.reload();
    await page.waitForSelector('.day-row', { timeout: 10000 });
    await waitForReadsToLand(page);
    await expect(page.locator('.dialog-overlay'), 'discarded is discarded').toHaveCount(0);
});

test('admin: another member signing in on the same phone is offered nothing — the rows stay G. Miller\'s', async ({ page }) => {
    await stageAbsenceAndHide(page);
    await seedMemberSession(page, 'S. Silva');   // a later init script: this reload is S. Silva's
    await reloadPastLeaveSite(page);
    await page.waitForSelector('.day-row', { timeout: 10000 });
    await waitForReadsToLand(page);
    await expect(page.locator('.dialog-overlay'), 'never across members').toHaveCount(0);
    await expect(page.locator('#saveBtn')).toBeDisabled();
    expect(await page.evaluate((k) => localStorage.getItem(k), ADMIN_DRAFT), 'G. Miller\'s copy is left for G. Miller').not.toBeNull();
});

// ── A WEEK LEFT OPEN IS READ AGAIN WHEN THE APP COMES BACK (iPhone audit, Nov 2026) ─────────────
// An installed app is not reloaded when it is reopened — iOS keeps it resident for days — and Admin
// read its week once, with "Today" stamped as it drew. Back after five minutes away, with nothing
// staged and nothing sending, the week is read and drawn again; a glance at another app is not.
/** Open Admin on this week (Thu 27 Aug 2026) with the clock fixed at midday UTC, so the local date
 *  is the same in any time zone the runner is in. @param {import('@playwright/test').Page} page */
async function openAdminOnThisWeek(page) {
    await page.clock.setFixedTime(new Date('2026-08-27T12:00:00Z'));
    await seedMemberSession(page, 'G. Miller');
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    await waitForReadsToLand(page);
    await expect(page.locator('.day-row.today')).toHaveAttribute('data-date', '2026-08-27');
}
/** A colleague's booking of Tue 25 Aug, arriving on the server while this page is away. @param {import('@playwright/test').Page} page */
const colleagueBooksTuesday = (page) => page.evaluate(() => {
    /** @type {any} */ (window).__E2E.docs = [{ id: 'away1', memberName: 'G. Miller', date: '2026-08-25',
        type: 'annual_leave', value: 'AL', note: '', source: 'manual' }];
});
const reads = (/** @type {import('@playwright/test').Page} */ page) => page.evaluate(() => /** @type {any} */ (window).__E2E.docReads || 0);

test('admin: back after five minutes away, the week is read and drawn again — Today included — and not after a glance', async ({ page }) => {
    await openAdminOnThisWeek(page);
    const tuesday = page.locator('.day-row[data-date="2026-08-25"]');
    await expect(tuesday).not.toHaveClass(/has-override/);
    const before = await reads(page);
    await setVisibility(page, 'hidden');
    await colleagueBooksTuesday(page);
    await page.clock.setFixedTime(new Date('2026-08-27T12:04:00Z'));
    await setVisibility(page, 'visible');
    expect(await reads(page), 'four minutes away is a glance: nothing is read').toBe(before);
    await expect(tuesday).not.toHaveClass(/has-override/);

    await setVisibility(page, 'hidden');
    await page.clock.setFixedTime(new Date('2026-08-28T12:00:00Z'));   // the phone sleeps until the next day
    await setVisibility(page, 'visible');
    await expect(tuesday, 'the colleague\'s booking is on the week now').toHaveClass(/has-override/);
    await expect(page.locator('.day-row.today'), 'and Today has moved on with the clock').toHaveAttribute('data-date', '2026-08-28');
    expect(await reads(page)).toBeGreaterThan(before);
});

test('admin: with staged rows, coming back reads nothing and leaves the edit alone', async ({ page }) => {
    await openAdminOnThisWeek(page);
    const thursday = page.locator('.day-row[data-date="2026-08-27"]');
    await clickInView(thursday.locator('.type-pill-btn[data-type="sick"]'));
    await expect(page.locator('#saveBtn')).toBeEnabled();
    const before = await reads(page);
    await setVisibility(page, 'hidden');
    await colleagueBooksTuesday(page);
    await page.clock.setFixedTime(new Date('2026-08-28T12:00:00Z'));
    await setVisibility(page, 'visible');
    // Read where a re-read WOULD have started: `loadOverrides` reaches getDocs a microtask after the
    // event, long before this next round trip to the page.
    expect(await reads(page), 'nothing is read over unsaved work').toBe(before);
    await expect(thursday.locator('.type-pill-btn[data-type="sick"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.day-row[data-date="2026-08-25"]')).not.toHaveClass(/has-override/);
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

    await scroll('#alRpNext');
    await expect(page.locator('#alRpLabel, #alRangePicker .rp-label')).toContainText('2027');
    const nextYear = await read();
    expect(nextYear.taken, 'leave taken in 2026 is being counted against 2027').toBe(0);
    expect(nextYear.remaining, 'a year with nothing booked shows the whole entitlement')
        .toBe(nextYear.entitlement);

    await scroll('#alRpPrev');
    const backAgain = await read();
    expect(backAgain, 'the banner latched on the later year instead of tracking the picker')
        .toEqual(thisYear);
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

test('admin: saving reports the DAYS it changed, not just how many', async ({ page }) => {
    // executeSave refuses without a Firebase user ("You've been signed out"), which is right — so
    // opt the stub in, the way every other spec that reaches a real write does.
    await page.addInitScript(() => { window.__E2E = { ...(window.__E2E || {}), authUser: true }; });
    await seedSession(page, 'G. Miller');

    // ── THIS TEST NAVIGATES TO A FIXED WEEK, AND IT HAS TO (v24.19) ────────────────────────────
    //
    // It needs a CLEAN multi-day save: it bulk-applies ANNUAL LEAVE to Mon–Fri and asserts the
    // receipt names the days it changed. Since v23.75, annual leave on a base REST DAY is asked
    // about rather than defaulted — "say whether this rest day was a swapped working day" — and the
    // save REFUSES until every affected day is answered. That rule is correct, and it is not what
    // this test is about.
    //
    // Whether Mon–Fri contains a rest day depends on where the default member's rotation sits in
    // the week the page opens on, and the page opened on TODAY's week. So this test passed or
    // failed according to the date it was run on, with nothing in it saying so. It went red on
    // 20 Sep 2026 — on main, on both engines, and on the retry — having never been touched.
    //
    // NOT `page.clock.setFixedTime`, which is how the rest of this suite pins time: freezing the
    // clock here stops the week grid rendering at all (`.day-row` never appears), so the page never
    // gets as far as the thing under test. Driving the app's OWN week navigation is both closer to
    // what a user does and immune to that.
    //
    // The week is one where the dropdown's first member — L. Springer, which is what a fresh
    // profile selects — works all five days. If the roster data ever moves under this, the failure
    // is the app's own refusal naming the offending date, which says exactly what happened; a scan
    // of `getBaseShift` over successive Sundays finds the next clean week.
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });

    await page.locator('#fieldDate').evaluate((el) => {
        /** @type {HTMLInputElement} */ (el).value = '2027-01-11';       // Monday
        el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    // Fail LOUDLY if that did not land where it should, rather than through whatever the save does
    // about it — a wrong week would make every assertion below meaningless.
    await expect(page.locator('#weekNavLabel')).toContainText('Jan 2027');

    // Stage several days through the real bulk path, then save.
    await page.locator('#bulkSelMonFri').click();
    await page.locator('#bulkTypePills .pill-annual_leave').click();
    await page.locator('#bulkApplyBtn').click();
    await page.locator('#saveBtn').click();

    const feedback = page.locator('#formFeedback');
    await expect(feedback).toContainText('changes saved for', { timeout: 10000 });

    // The receipt itself: folded, and naming one day per line when opened.
    const receipt = feedback.locator('.save-receipt');
    await expect(receipt).toBeVisible();
    await expect(receipt).not.toHaveAttribute('open', '');
    await receipt.locator('summary').click();
    const lines = receipt.locator('li');
    expect(await lines.count(), 'one line per changed day').toBeGreaterThan(1);
    // And the headline's count agrees with the list it folds — two passes over one state, which is
    // exactly where a summary and its detail drift apart.
    const headline = await feedback.textContent();
    const stated = Number((headline || '').match(/(\d+) changes? saved/)?.[1]);
    expect(await lines.count(), 'the headline must agree with its own receipt').toBe(stated);
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

// Whole-app review, Oct 2026: a leave range picked while the member's records were still loading was
// previewed from an empty cache — asking about a rest day the records show is worked (RDW) — and the
// load refreshed the banners but never the preview, so the question stayed.
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
    await expect(preview, 'premise: drawn before the records arrived').toContainText('rest day to answer');
    await page.evaluate(() => { /** @type {any} */ (window).__E2E.docsHeld = false; });   // the records land
    await expect(preview).toContainText('recorded at no cost', { timeout: 8_000 });
    await expect(preview).not.toContainText('rest day to answer');
});

test('admin: a save that is waiting for the server says so, and the notice clears when it lands', async ({ page }) => {
    await page.addInitScript(() => {
        window.__E2E = { ...(window.__E2E || {}), authUser: true, holdCommits: true, slowSaveMs: 300 };
    });
    await seedSession(page, 'G. Miller');
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    // The same fixed, all-working week the receipt test uses, and for the same reason: annual leave on
    // a rest day is asked about and refused until answered, which is not what this test is about.
    await page.locator('#fieldDate').evaluate((el) => {
        /** @type {HTMLInputElement} */ (el).value = '2027-01-11';
        el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect(page.locator('#weekNavLabel')).toContainText('Jan 2027');
    await page.locator('#bulkSelMonFri').click();
    await page.locator('#bulkTypePills .pill-annual_leave').click();
    await page.locator('#bulkApplyBtn').click();
    await page.locator('#saveBtn').click();

    const notice = page.locator('#slowSaveNotice');
    await expect(notice).toBeVisible({ timeout: 5000 });
    // ONLINE, so the signal is not named (v24.54): an iPhone with full bars was told "Waiting for
    // signal" on every save. The offline wording is the next test.
    await expect(notice).toContainText('Still sending');
    await expect(notice).not.toContainText(/signal/i);
    await expect(notice).toContainText('held on this device');
    await expect(notice, 'a held write can still be refused — it must never be called saved').not.toContainText(/saved/i);
    await expect(notice).toHaveAttribute('role', 'status');
    // The button stays disabled while the write is unconfirmed: freeing it would invite a second
    // save of the same days, and every save mints new document ids.
    await expect(page.locator('#saveBtn')).toBeDisabled();
    // …and so is the sticky bar (v24.23): its Discard stayed live, and a "discarded" save landed anyway.
    await expect(page.locator('#stagedDiscardBtn')).toBeDisabled();
    await expect(page.locator('#stagedSaveBtn')).toBeDisabled();
    await expect(page.locator('#formFeedback')).not.toContainText('changes saved for');

    await page.evaluate(() => /** @type {any} */ (window).__E2E.releaseCommits());
    await expect(notice).toBeHidden({ timeout: 5000 });
    await expect(page.locator('#formFeedback')).toContainText('changes saved for', { timeout: 10000 });
    await expect(page.locator('#stagedDiscardBtn'), 'the sticky bar must come back once the save lands').toBeEnabled();
    // …and it LEFT A RECORD (v24.54): a save slower than the threshold while the browser said it was
    // online is written to the admin's Error Log, so a phone whose every save is slow says so.
    await expect.poll(() => page.evaluate(() => (/** @type {any} */ (window).__E2E.setWrites || [])
        .filter((/** @type {any} */ w) => /^Slow save \(diagnostic\)/.test(w.data?.message ?? ''))
        .map((/** @type {any} */ w) => w.data.message)), { timeout: 5000 })
        .toEqual([expect.stringMatching(/took \d+\.\ds to be confirmed — a save while the phone said it was online · sign-in token \d+\.\ds · /)]);
});

test('admin: a slow save says "Waiting for signal" only when the browser reports being offline (v24.54)', async ({ page, context }) => {
    await page.addInitScript(() => {
        window.__E2E = { ...(window.__E2E || {}), authUser: true, holdCommits: true, slowSaveMs: 300 };
        // The save's own 'done' event, kept for the spec: the diagnostic is decided when it fires.
        window.addEventListener('myb-slow-save', (e) => {
            const d = /** @type {CustomEvent} */ (e).detail;
            if (d?.phase === 'done') /** @type {any} */ (window).__slowSaveDone = d;
        });
    });
    await seedSession(page, 'G. Miller');
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    await page.locator('#fieldDate').evaluate((el) => {
        /** @type {HTMLInputElement} */ (el).value = '2027-01-11';
        el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect(page.locator('#weekNavLabel')).toContainText('Jan 2027');
    await page.locator('#bulkSelMonFri').click();
    await page.locator('#bulkTypePills .pill-annual_leave').click();
    await page.locator('#bulkApplyBtn').click();
    await context.setOffline(true);
    await page.locator('#saveBtn').click();
    const notice = page.locator('#slowSaveNotice');
    await expect(notice).toBeVisible({ timeout: 5000 });
    await expect(notice).toContainText('Waiting for signal');
    await context.setOffline(false);
    // A save that was slow because the phone was OFFLINE is the expected case — it is not recorded.
    await page.evaluate(() => /** @type {any} */ (window).__E2E.releaseCommits());
    await expect(notice).toBeHidden({ timeout: 5000 });
    await expect(page.locator('#formFeedback')).toContainText('changes saved for', { timeout: 10000 });
    // Not a 500ms sleep (test audit, 7 Nov 2026): the reporter writes its diagnostic, or does not, INSIDE the
    // save's 'done' event (error-reporter.js), and the write is recorded as it is made. So once that
    // event has fired the answer is in — and it must have said OFFLINE, or the absence below would
    // be the absence of an online save's record, which proves nothing about this rule.
    await expect.poll(() => page.evaluate(() => /** @type {any} */ (window).__slowSaveDone?.onlineWhenSlow ?? 'no done event'),
        { message: 'premise: the save ended, and it was slow while the browser said it was offline' }).toBe(false);
    expect(await page.evaluate(() => (/** @type {any} */ (window).__E2E.setWrites || [])
        .filter((/** @type {any} */ w) => /^Slow save/.test(w.data?.message ?? '')).length),
        'an offline-when-slow save must not be logged as a diagnostic').toBe(0);
});

// ── A SAVE WHOSE ACCOUNT IS REVOKED ENDS, AND SAYS WHERE TO SIGN IN (v24.36 / v24.37) ─────────────
//
// Reported: a manager's or member's save sat on "Saving…" for good. A refused token refresh signs the
// account out, and Firestore never settles that account's pending commit (claim-retry.js). This holds
// a commit open through the REAL Change-a-Shift path, revokes the session the way production does, and
// checks the three things the release promises: the button comes back, the message calls the change
// unconfirmed rather than lost, and the sign-in box is there to act on it. The unit tests prove the
// helpers; only this proves they are wired to the save.
test('admin: a save whose sign-in is revoked mid-save stops waiting and offers the sign-in', async ({ page }) => {
    await page.addInitScript(() => {
        window.__E2E = { ...(window.__E2E || {}), authUser: true, holdCommits: true };
    });
    await seedSession(page, 'G. Miller');
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    await page.locator('#fieldDate').evaluate((el) => {
        /** @type {HTMLInputElement} */ (el).value = '2027-01-11';
        el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect(page.locator('#weekNavLabel')).toContainText('Jan 2027');
    await page.locator('#bulkSelMonFri').click();
    await page.locator('#bulkTypePills .pill-annual_leave').click();
    await page.locator('#bulkApplyBtn').click();
    await page.locator('#saveBtn').click();
    await expect(page.locator('#saveBtn')).toContainText('Saving');

    await page.evaluate(() => /** @type {any} */ (window).__E2E.revokeAuth());

    const feedback = page.locator('#formFeedback');
    await expect(feedback).toContainText('signed out before this change was confirmed', { timeout: 5000 });
    await expect(feedback).toContainText('Saved Changes');
    await expect(feedback, 'the write is held, not lost').not.toContainText(/lost|not saved/i);
    await expect(page.locator('#saveBtn')).not.toContainText('Saving');
    // The sign-in box the message sends them to (v24.37) — without it "sign in again" meant a reload.
    await expect(page.locator('#loginPassword')).toBeVisible({ timeout: 8000 });
});

// ── AN UNCONFIRMED SAVE STOPS THE NEXT ONE UNTIL RELOAD (v24.39, external review) ──────────────
// The abandoned write is still queued for that account. Signed back in, a second press minted fresh
// ids and wrote a second copy beside the first. The page now refuses any new write until reloaded.
test('admin: after a save left unconfirmed by a sign-out, the next save is refused until reload', async ({ page }) => {
    await page.addInitScript(() => { window.__E2E = { ...(window.__E2E || {}), authUser: true, holdCommits: true }; });
    await seedSession(page, 'G. Miller');
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    await page.locator('#fieldDate').evaluate((el) => {
        /** @type {HTMLInputElement} */ (el).value = '2027-01-11';
        el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect(page.locator('#weekNavLabel')).toContainText('Jan 2027');
    await page.locator('#bulkSelMonFri').click();
    await page.locator('#bulkTypePills .pill-annual_leave').click();
    await page.locator('#bulkApplyBtn').click();
    await page.locator('#saveBtn').click();
    await expect(page.locator('#saveBtn')).toContainText('Saving');
    await page.evaluate(() => /** @type {any} */ (window).__E2E.revokeAuth());
    await expect(page.locator('#formFeedback')).toContainText('signed out before this change was confirmed', { timeout: 5000 });
    // Signed straight back in (another tab): the account is here again, so nothing else stops a retry.
    await page.evaluate(() => /** @type {any} */ (window).__E2E.restoreAuth());
    const before = await page.evaluate(() => /** @type {any} */ (window).__E2E.batchWrites.length);
    await page.locator('#saveBtn').click();
    await expect(page.locator('#formFeedback')).toContainText('Reload the page before making another', { timeout: 5000 });
    expect(await page.evaluate(() => /** @type {any} */ (window).__E2E.batchWrites.length), 'no second copy was written').toBe(before);
});

// ── …AND A COLLEAGUE SIGNING IN FROM ANOTHER TAB IS NOT THAT (v24.38) ────────────────────────────
// Firebase shares one account across a browser's tabs. v24.37 read a colleague's sign-in elsewhere
// (out, then in as them) as this page's loss, and its re-login signed the colleague out.
test('admin: a colleague signing in from another tab does not sign anybody out here', async ({ page }) => {
    await page.addInitScript(() => { window.__E2E = { ...(window.__E2E || {}), authUser: true }; });
    await page.clock.install();   // runs in real time until the fastForward below; nothing is pinned
    await seedSession(page, 'G. Miller');
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    const before = await page.evaluate(() => /** @type {any} */ (window).__E2E.signOutCount || 0);
    await page.evaluate(() => /** @type {any} */ (window).__E2E.otherTabSignIn());
    // Past the watcher's 3s settle on the PAGE's clock (test audit, 7 Nov 2026: this was a real 4.5s sleep).
    // A sign-out is judged only once it has lasted that long (watchIdentityLoss, claim-retry.js), so
    // nothing can be concluded before the settle has run: fastForward fires every timer due inside
    // the jump, the settle's included, and the assertions below read the page after it.
    await page.clock.fastForward(4_500);
    await expect(page.locator('#loginPassword')).toHaveCount(0);
    expect(await page.evaluate(() => /** @type {any} */ (window).__E2E.signOutCount || 0), 'nobody signed out').toBe(before);
    expect(await page.evaluate(() => localStorage.getItem('myb_admin_session')), 'the shared session survives').not.toBeNull();
});

// ── SUNDAY IS NOT A CONTRACTED DAY — LAYERS 1 AND 2, AS THE GRID ACTUALLY DRAWS THEM ────────────
//
// CLAUDE.md's Sunday rule has six enforcement layers and says none of them is removable alone. Two
// of them live in `admin-week-editor.js` — the per-row pills a manager presses, and the bulk sweep
// that stages a whole week at once — and until now neither had a behavioural test in any lane. A
// mutation sweep replaced each guard's condition with `false` and everything stayed green.
//
// What already existed is a SOURCE pin (override-utils.test.mjs, "LAYER 1 disables a pill for every
// forbidden type"), which asserts the layer mentions a `.pill-<type>` for each forbidden type. That
// is real coverage of DRIFT — a fifth forbidden type not wired into the grid — and no coverage at
// all of the guard: the strings sit INSIDE the `if`, so they survive its condition being deleted.
// Only a rendered row can answer whether the pill is actually dead.
//
// NEITHER FAILURE IS LOUD, AND NEITHER LOSES THE SUNDAY. A staged Sunday row reaches the `#saveBtn`
// handler in admin-app.js — layer 6, which still answers for every forbidden type, so nothing wrong
// is written. (`executeSave` in admin-overrides.js, the writer underneath it, has no Sunday guard
// and does not need one; it never sees the row.) But layer 6 answers by pushing an error, and the
// save aborts the WHOLE batch on the first one. Measured with layer 2 removed: a seven-day AL sweep
// wrote NOTHING — zero batch writes, one row flagged, six legitimate days lost with it. So what a
// missing layer costs is never the Sunday; it is the rest of the week, and it arrives as a dead end
// at the end instead of a closed door at the start.
//
// Both read the list from override-utils.js rather than restating it (CLAUDE.md forbids a new call
// site restating the four types), so a fifth forbidden type joins these tests by being declared.

/** The dates of the rendered week, keyed by weekday. The grid always runs Sunday→Saturday, but the
 *  assertions name the day rather than an index so a failure says which day it meant. */
async function weekGridDates(page) {
    return page.evaluate(() => Object.fromEntries(
        [...document.querySelectorAll('.day-row')].map(r => {
            const iso = /** @type {HTMLElement} */ (r).dataset.date || '';
            return [['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][new Date(iso + 'T12:00:00').getDay()], iso];
        })));
}

test('admin: the Sunday row offers no pill for anything that cannot be recorded on a Sunday', async ({ page }) => {
    await seedSession(page, 'G. Miller');
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });

    const days = await weekGridDates(page);
    expect(days.sun, 'the week grid always draws a Sunday').toBeTruthy();
    const sunday  = page.locator(`.day-row[data-date="${days.sun}"]`);
    const weekday = page.locator(`.day-row[data-date="${days.wed}"]`);

    for (const type of SUNDAY_FORBIDDEN_TYPES) {
        await expect(sunday.locator(`.pill-${type}`), `${type} must not be pressable on a Sunday`)
            .toBeDisabled();
        // A disabled button leaves the tab order, so the reason has to be in the accessible name —
        // it used to be a `title`, which no phone shows (v23.50). Asserted alongside the state it
        // explains: a grey pill nobody can ask about is the same dead end from the other side.
        await expect(sunday.locator(`.pill-${type}`)).toHaveAttribute('aria-label', /Sunday/);
        // The SAME pill on a weekday is live — so this is the Sunday rule biting, not a row that
        // failed to render or a member whose overrides never loaded.
        await expect(weekday.locator(`.pill-${type}`), `${type} is recordable on a weekday`).toBeEnabled();
    }
    // And the one thing that DOES belong on a Sunday is still offered. Sundays are uncontracted, so
    // Sunday work is overtime; a row where every pill were dead would pass the loop above while
    // making a genuinely payable shift unrecordable.
    await expect(sunday.locator('.pill-rdw')).toBeEnabled();
});

test('admin: a bulk sweep of all seven days stages six — the Sunday is dropped, and it says so', async ({ page }) => {
    await seedSession(page, 'G. Miller');

    // Every forbidden type the bulk bar actually offers. `other` is applied per-row (it needs a
    // flavour the bar cannot host), so the bar is PILL_TYPES minus that one — read off the rendered
    // bar rather than listed here, for the same reason the loop below is.
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    const offered = await page.evaluate(types => types.filter(t => document.querySelector(`#bulkTypePills .pill-${t}`)),
        [...SUNDAY_FORBIDDEN_TYPES]);
    expect(offered.length, 'the bulk bar must offer at least one forbidden type, or this proves nothing')
        .toBeGreaterThan(0);

    for (const type of offered) {
        await page.goto('/admin.html');
        await page.waitForSelector('.day-row', { timeout: 10000 });
        const days = await weekGridDates(page);

        await page.locator('#bulkSelAll').click();
        await page.locator(`#bulkTypePills .pill-${type}`).click();
        await page.locator('#bulkApplyBtn').click();

        const staged = await page.evaluate(() => Object.fromEntries(
            [...document.querySelectorAll('.day-row')].map(r => {
                const el = /** @type {HTMLElement} */ (r);
                return [el.dataset.date, el.dataset.type || ''];
            })));
        expect(staged[days.sun], `${type} must not stage on a Sunday`).toBe('');
        // The other six DID take it — the sweep is being filtered, not broken. Without this, a
        // guard that skipped every row would pass the line above.
        for (const key of ['mon', 'tue', 'wed', 'thu', 'fri', 'sat']) {
            expect(staged[days[key]], `${key} is a contracted day and must take ${type}`).toBe(type);
        }
        // "All 7 → 6 applied" is a surprise unless it is stated. This is the only place the manager
        // is told, and it is what stops the drop reading as a lost tap.
        await expect(page.locator('#formFeedback')).toContainText('Sunday skipped');
        // Each visit leaves the page CLEAN (iPhone audit, Nov 2026). Rows left staged when a page goes
        // are kept and offered back on the next load (unsaved-draft.js) — the next visit would open on
        // that question, which is not what this loop is about.
        await page.locator('#stagedDiscardBtn').click();
        await expect(page.locator('#saveBtn')).toBeDisabled();
    }
});

// ── THE STAGED OVERRIDE LOAD (v21.38, external review) ──────────────────────────────────────────
//
// Admin used to read the newest few thousand documents of the whole collection on every open and
// filter them locally. It now reads the selected member, and the collection only when the All-staff
// view asks. The claim is entirely about WHICH QUERY RUNS, and that is invisible from the rendered
// table — both versions draw a correct-looking list. So these read `__E2E.whereCalls`, which the
// stub records for exactly this reason.
test('admin boot reads ONE member, not the whole overrides collection', async ({ page }) => {
    await seedSession(page, 'G. Miller');
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });

    // Asserted against the LIVE field rather than a hardcoded name: admin restores its own selected
    // member (saved, or the first in the list), which is not the session's member — an earlier draft
    // of this assumed it was and failed against perfectly correct code.
    const { wheres, selected } = await page.evaluate(() => ({
        wheres: (window.__E2E?.whereCalls || []).filter(w => w[0] === 'memberName'),
        selected: /** @type {HTMLSelectElement|null} */ (document.getElementById('fieldMember'))?.value,
    }));
    expect(wheres.length, 'the boot load must filter by memberName').toBeGreaterThan(0);
    expect(wheres[0], 'and by the member the page is actually showing')
        .toEqual(['memberName', '==', selected]);
});

test('admin: switching member fetches THAT member, and their week is not drawn as empty first',
    async ({ page }) => {
        // The silent-wrong-answer case. An unfetched member and a member with a clear week produce
        // the same empty slice, so painting the grid before their data lands would show seven
        // base-roster days and read as "nothing recorded for them".
        await seedSession(page, 'G. Miller');
        await page.goto('/admin.html');
        await page.waitForSelector('.day-row', { timeout: 10000 });

        const select = page.locator('#fieldMember');
        const other = await select.evaluate((el) => {
            const sel = /** @type {HTMLSelectElement} */ (el);
            const opt = [...sel.options].find(o => o.value && o.value !== sel.value);
            return opt ? opt.value : '';
        });
        expect(other, 'the roster needs a second selectable member for this test').not.toBe('');

        await select.selectOption(other);
        await expect.poll(async () => page.evaluate(() => (window.__E2E?.whereCalls || [])
            .filter(w => w[0] === 'memberName').map(w => w[2])),
        { message: 'selecting a member must fetch that member' }).toContain(other);
        // And the grid comes back: the loading state is a moment, not a dead end.
        await expect(page.locator('.day-row').first()).toBeVisible({ timeout: 10000 });
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
    await expect(page.locator('#alHeaderBalance'), 'and no "AL left" chip on the collapsed header')
        .toBeHidden();
    await expect(page.locator('#alBookedBox'), 'and no dates list implying nothing is booked')
        .toBeHidden();
    // Asserted as TEXT as well, because `hidden` on a banner that also sets `display` renders a
    // live element while every check believes it is gone — the page-visibility-parity trap.
    await expect(page.locator('#alBanner')).toHaveCSS('display', 'none');
    // And no balance is READABLE anywhere on the card, however it got there. `innerText`, not
    // `textContent`: the chip keeps its last value in the DOM while hidden, so textContent finds
    // "AL left: 32" on a perfectly correct page and the assertion would fail for the wrong reason.
    // This is the one that would catch a THIRD surface printing the figure.
    const visible = await page.locator('#book-annual-leave').innerText();
    expect(visible, 'no readable balance over a read that failed').not.toMatch(/AL left:/i);
});

// ── THE LIST COUNTS WHAT THE ENTITLEMENT COUNTS (v23.72, owner report) ─────────────────────────
//
// The owner compared the app against the roster office's own leave spreadsheet and found M. Robson
// a day apart: the app's December period read "Sat 5 – Fri 11 Dec · 6 days", the spreadsheet said
// Mon 7 – Fri 11, and his chips summed to 33 against an allowance of 32.
//
// SAT 5 DEC 2026 IS A REST DAY on his line, and an AL override had been recorded on it. The
// entitlement maths was already right — `consumesEntitlement` returns false for a rest day, so his
// banner correctly read 32 of 32 — but the recorded-dates list filtered SUNDAYS and nothing else,
// counted the rest day, and started the period a day before his leave did. One card, two
// disagreeing counts of the same thing, with the wrong one next to the ✕ that deletes it.
//
// REAL MEMBER, REAL ROSTER, REAL DATES. The fix is to hand the list the entitlement rule itself
// rather than a second copy of it, so this test is worth nothing unless it runs against a genuine
// rest day: `getBaseShift(M. Robson, 2026-12-05)` is 'RD' because of where his week-4 main line
// falls, which no fixture here asserts and a roster edit could change. The first assertion below
// therefore pins the PREMISE — if his line moves, this fails loudly as a stale test rather than
// passing while measuring nothing.
// CHRISTMAS LEAVE IS PART OF THESE LISTS (v25.37, owner 5 Nov 2026): a member due at work on 25/26
// December has a 🎄 row in that year's Recorded Annual Leave, which is a record and not a booking. The
// tests below are about BOOKINGS, so they count `BOOKED_ROWS`, and pin the clock — the Christmas rows
// listed run up to the current year, so a real clock would change what these lists hold every January.
const BOOKED_ROWS = '#alBookedBody .al-period-row:not(.al-period-row--christmas)';

test('admin: an AL day on a REST day is not listed and does not count', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-11-05T09:00:00Z'));
    await seedSession(page, 'G. Miller');
    await page.addInitScript(() => {
        /** @type {any} */ (window).__E2E = Object.assign(/** @type {any} */ (window).__E2E || {}, {
            docs: [
                // Sat 5 Dec — the rest day. Recorded, and spends nothing.
                { id: 'r1', memberName: 'M. Robson', date: '2026-12-05', type: 'annual_leave', value: 'AL', note: '' },
                // Mon 7 – Fri 11 — the leave he actually took.
                { id: 'r2', memberName: 'M. Robson', date: '2026-12-07', type: 'annual_leave', value: 'AL', note: '' },
                { id: 'r3', memberName: 'M. Robson', date: '2026-12-08', type: 'annual_leave', value: 'AL', note: '' },
                { id: 'r4', memberName: 'M. Robson', date: '2026-12-09', type: 'annual_leave', value: 'AL', note: '' },
                { id: 'r5', memberName: 'M. Robson', date: '2026-12-10', type: 'annual_leave', value: 'AL', note: '' },
                { id: 'r6', memberName: 'M. Robson', date: '2026-12-11', type: 'annual_leave', value: 'AL', note: '' },
            ],
        });
    });
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });

    // THE PREMISE, asserted before anything is measured against it.
    const premise = await page.evaluate(async () => {
        const rd = await import('./roster-data.js');
        const m = rd.teamMembers.find(x => x.name === 'M. Robson');
        return { five: String(rd.getBaseShift(m, rd.parseISODate('2026-12-05'))),
                 seven: String(rd.getBaseShift(m, rd.parseISODate('2026-12-07'))) };
    });
    expect(premise.five, 'Sat 5 Dec 2026 must be a REST day on M. Robson\'s line, or this test proves nothing')
        .toMatch(/^(RD|OFF)$/);
    expect(premise.seven, 'Mon 7 Dec 2026 must be a working day, or the expected period is wrong')
        .not.toMatch(/^(RD|OFF)$/);

    await page.locator('#fieldMember').selectOption('M. Robson');
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
// order among the real bookings. G. Miller is due at work on both days in 2026 and has worked Boxing
// Day, so only Christmas Day is leave, and his allowance is one higher.
test('admin: Christmas leave is listed with the recorded leave, not counted, with nothing to delete', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-12-10T09:00:00Z'));
    await seedSession(page, 'G. Miller');
    await page.addInitScript(() => {
        /** @type {any} */ (window).__E2E = Object.assign(/** @type {any} */ (window).__E2E || {}, {
            docs: [
                { id: 'a1', memberName: 'G. Miller', date: '2026-12-21', type: 'annual_leave', value: 'AL', note: '' },
                { id: 'bx', memberName: 'G. Miller', date: '2026-12-26', type: 'rdw', value: '13:30-21:00', note: '' },
            ],
        });
    });
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    await page.locator('#fieldMember').selectOption('G. Miller');
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
    // One day: he works the Boxing Day he was due to work, so only Christmas Day is leave.
    await expect(xmas.locator('.al-period-free')).toHaveText('1 day');
    await expect(xmas.locator('.al-period-note')).toContainText('Not counted');
    await expect(xmas.locator('.al-period-note')).toBeVisible();
    await expect(xmas.locator('button'), 'nothing is stored, so there is nothing to delete').toHaveCount(0);
    // The real booking still counts one day — the Christmas row added nothing to it.
    await expect(rows.nth(0).locator('.al-period-count')).toHaveText('1 day');

    await expect(page.locator('#alBannerEntitlement')).toHaveText('33');
    await expect(page.locator('#alBannerTaken')).toHaveText('0');
    await expect(page.locator('#alBannerBooked')).toHaveText('1');
    await expect(page.locator('#alBannerBreakdown')).toHaveText('Includes 1 day in lieu for working Boxing Day');
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

// THE RECORDED-LEAVE LIST OPENS ON THE CURRENT YEAR, and these four tests seed 2026 leave and expect
// to read it there (test audit, 7 Nov 2026). On the real clock, from 1 Jan 2027 the list opens on 2027 —
// which holds G. Miller's and S. Silva's Christmas 2027 leave, so it is not empty and nothing falls back
// — and all four failed (proved with the clock pinned to 4 Jan 2027). They are about the year chips
// and the delete controls, not about today, so they pin a 2026 day. So do three more further down
// that seed 2026 leave — the year scroll, the stale delete and the over-limit message — which the
// whole Chromium suite, run with the clock pinned to 4 Jan and 1 Mar 2027, found failing the same way.
const LEAVE_LIST_DAY = new Date('2026-11-03T09:00:00Z');

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
    await expect(btn, 'first tap asks').toHaveText('Confirm?');
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
    await expect(btn).toHaveText('Confirm?');
    await btn.click();

    const toast = page.locator('#saveToast');
    await expect(toast).toHaveClass(/visible/);
    await expect(toast).toHaveText(/Deleted 1 AL day for G\. Miller/);
    // And the row is gone: with no leave left the box hides rather than showing an empty year.
    await expect(page.locator('#alBookedBox')).toBeHidden();
});

// A STALE DELETE IS REFUSED (Oct 2026 production review). Admin's cache never refreshes on its own,
// and a manual record has one id per member and day, so deleting what this page showed hours ago
// removed what a colleague had written since. Before deleting, the page re-reads the documents; here
// the server answers that the day now holds a different record.
test('admin: a booked period a colleague has since changed is not deleted, and the admin is told', async ({ page }) => {
    await page.clock.setFixedTime(LEAVE_LIST_DAY);   // the list must open on 2026, where the booking is
    await seedMemberSession(page, 'G. Miller');
    await page.addInitScript(() => {
        /** @type {any} */ (window).__E2E = Object.assign(/** @type {any} */ (window).__E2E || {}, {
            docs: [{ id: 'a1', memberName: 'G. Miller', date: '2026-03-02', type: 'annual_leave', value: 'AL', note: '' }],
            // What the server holds NOW: another manager has made the day a worked rest day.
            getDocData: { memberName: 'G. Miller', date: '2026-03-02', type: 'rdw', value: '09:00-17:00' },
        });
    });
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    await page.locator('#fieldMember').selectOption('G. Miller');
    await page.locator('#alToggleHeader').click();
    await page.locator('#alBookedToggle').click();
    const btn = page.locator('#alBookedBody .btn-period-delete').first();
    await btn.click();
    await btn.click();
    await expect(page.locator('#alFeedback')).toContainText(/Someone else has changed this/);
    expect(await page.evaluate(() => (window.__E2E?.batchDeletes || []).length), 'something was deleted').toBe(0);
    await expect(page.locator('#alBookedBody .btn-period-delete')).toHaveCount(1);
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
    await expect(btn).toHaveAttribute('aria-label', 'Delete G. Miller 2026-09-01');
    await btn.click();
    await expect(btn).toHaveText('Delete?');
    await expect(btn, 'armed: the name says so').toHaveAttribute('aria-label', 'Confirm delete G. Miller 2026-09-01');
    // Let the confirm lapse (5s) rather than pressing again: the name has to come back WITH the glyph.
    await expect(btn, 'idle again: the name comes back with the glyph').toHaveAttribute('aria-label', 'Delete G. Miller 2026-09-01', { timeout: 7000 });
    await expect(btn).toHaveText('✕');
    await expect(btn).not.toHaveClass(/confirming/);
});

test('admin: a Saved Changes row is one row — controls side by side, under 64px', async ({ page }) => {
    await seedSession(page, 'G. Miller');
    await page.addInitScript(() => {
        /** @type {any} */ (window).__E2E = Object.assign(/** @type {any} */ (window).__E2E || {}, {
            docs: [
                { id: 'a', memberName: 'G. Miller', date: '2026-09-01', type: 'sick',  value: 'SICK', note: '' },
                { id: 'b', memberName: 'G. Miller', date: '2026-09-08', type: 'shift', value: '15:15-23:55', note: '' },
            ],
        });
    });
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    await page.locator('#fieldMember').selectOption('G. Miller');
    await page.locator('#overridesToggleHeader').click();
    const card = page.locator('.override-card').first();
    await expect(card).toBeVisible();

    const g = await card.evaluate(el => {
        const r = sel => /** @type {HTMLElement} */ (el.querySelector(sel)).getBoundingClientRect();
        return {
            row:   Math.round(el.getBoundingClientRect().height),
            dir:   getComputedStyle(/** @type {HTMLElement} */ (el.querySelector('.oc-actions'))).flexDirection,
            edit:  r('.btn-edit'), del: r('.btn-delete'),
        };
    });
    expect(g.dir, 'Edit and Delete sit side by side').toBe('row');
    expect(g.edit.height, 'Edit keeps its 44px target').toBeGreaterThanOrEqual(44);
    expect(g.del.height,  'Delete keeps its 44px target').toBeGreaterThanOrEqual(44);
    expect(Math.abs(g.edit.top - g.del.top), 'and they share a line').toBeLessThan(2);
    expect(g.row, 'the row is sized by its content, not a stacked control cluster').toBeLessThan(64);

    // The controls kept their names — the glyph alone has none.
    await expect(card.locator('.btn-edit')).toHaveAttribute('aria-label', /^Edit G\. Miller 2026-09-01$/);
    await expect(card.locator('.btn-delete')).toHaveAttribute('aria-label', /^Delete G\. Miller 2026-09-01$/);

    // One member on screen: the name is not repeated on every row…
    await expect(card.locator('.oc-member')).toBeHidden();
    // …and returns for All staff, where it is what tells the rows apart.
    await page.locator('#showAllOverridesBtn').click();
    await expect(page.locator('#showAllOverridesBtn')).toHaveText('This member only');
    await expect(page.locator('.override-card').first().locator('.oc-member')).toBeVisible();
});

test('admin: "All staff" fetches everyone rather than listing whoever happened to be loaded',
    async ({ page }) => {
        // A short list that looks complete is the failure the query-cap banner exists to prevent one
        // level up; rendering All staff from a per-member cache would be the same defect earlier.
        await seedSession(page, 'G. Miller');
        await page.goto('/admin.html');
        await page.waitForSelector('.day-row', { timeout: 10000 });

        // Saved Changes is a collapsible card and ships collapsed, so the toggle exists but is not
        // reachable until it is opened — the same route a manager takes.
        await page.locator('#overridesToggleHeader').click();
        const showAll = page.locator('#showAllOverridesBtn');
        await expect(showAll).toBeVisible();
        const before = await page.evaluate(() => window.__E2E?.docReads || 0);
        await showAll.click();

        await expect.poll(async () => page.evaluate(() => window.__E2E?.docReads || 0),
            { message: 'turning on All staff must run a collection read' })
            .toBeGreaterThan(before);
        await expect(showAll, 'and the toggle flips so it can be turned back off')
            .toHaveText('This member only');
    });

test('admin: the week-grid header and its rows share ONE column template, at every width', async ({ page }) => {
    // The header labels the rows; if the two grids resolve different tracks, the labels sit over
    // nothing in particular. They did. Both used `auto` for the base-roster column — and `auto` in
    // two separate grids sizes to each grid's OWN content, so "Base roster" (76.5px) and a badge
    // (110px) put the column 34px out of step. They shared a right edge, and only because both are
    // right-aligned; nothing made them agree. The 681–1023px layout was worse: its last `auto` was
    // 62px in the header and 194px in the rows, so the pills column was 132px wider in the header
    // than beneath it.
    //
    // Only a browser can see this — it is what the values RESOLVE to, not what the stylesheet says,
    // and the stylesheet said the same thing in both places. Every layout the page has is swept,
    // because the templates are declared in four separate blocks and it is the mid-range ones
    // nobody looks at.
    await seedSession(page);
    for (const width of [360, 390, 700, 800, 1023, 1024, 1280, 1440]) {
        await page.setViewportSize({ width, height: 1200 });
        await page.goto('/admin.html');
        await page.waitForSelector('.day-row', { timeout: 10000 });
        const m = await page.evaluate(() => {
            const h = document.querySelector('.week-grid-header');
            const r = document.querySelector('.day-row');
            const badge = r.querySelector('.col-base .shift-badge').getBoundingClientRect();
            const col = r.querySelector('.col-base').getBoundingClientRect();
            return {
                head: getComputedStyle(h).gridTemplateColumns,
                row:  getComputedStyle(r).gridTemplateColumns,
                badgeW: Math.round(badge.width), colW: Math.round(col.width),
                badgeGap: Math.round(r.getBoundingClientRect().right - badge.right),
                overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
                // An UNTOUCHED row (no tick, no type): its pills must not show, and it must not be
                // three lines of wrapped pills tall.
                rowH: Math.round(r.getBoundingClientRect().height),
                pillsShown: getComputedStyle(r.querySelector('.col-pills')).display !== 'none',
            };
        });
        // EVERY layout is stacked now (≤680px, and 681px up with no upper bound — polish round 2
        // moved the start from 1024px), so the base-roster badge is the row's last column and sits
        // against the right edge. Until the polish pass a ≥1400px block restated a five-column
        // template over the stacked placement: both grids still agreed (the assertion below passed)
        // while the badge sat mid-row at 1440 with a dead band beside it.
        expect(m.badgeGap, `@${width}px the base-roster badge must sit against the row's right edge`)
            .toBeLessThan(20);
        // The 681–1023px band used the five-column template until polish round 2: the time track
        // reserved ~194px on every row, so six pills wrapped onto three lines, showed on untouched
        // rows, and each row measured 132px at 800px. Stacked, an untouched row is its phone height.
        expect(m.pillsShown, `@${width}px an untouched row shows no type pills`).toBe(false);
        expect(m.rowH, `@${width}px an untouched row is one line of content, not three of pills`)
            .toBeLessThan(90);
        expect(m.head, `@${width}px the header and rows must resolve the SAME tracks`).toBe(m.row);
        expect(m.badgeW, `@${width}px the badge must not exceed the column it sits in`)
            .toBeLessThanOrEqual(m.colW);
        expect(m.overflow, `@${width}px the page must not scroll sideways`).toBe(false);
    }
});

test('admin: every base-roster badge in a week shares one left edge', async ({ page }) => {
    // The badges are right-aligned, so a variable width gives a ragged LEFT edge down the column —
    // measured at three different values over one seven-row week (654 / 615 / 613 at 1280px),
    // because `REST` is short, a time is long, and 🦉 is wider than ☀️. One width fixes it by
    // construction; `tabular-nums` is what stops the TIMES varying among themselves.
    //
    // The member is a FIXED-roster one for the reason given on the base-roster-time test below, and
    // for a second reason that only bites here: on a week where every badge is identical this
    // assertion PASSES TRIVIALLY — one left edge, because there is only one badge width to have an
    // edge. That is the worse half of the same clock dependence, because a green test proving
    // nothing is indistinguishable from a green test proving something. The distinct-text
    // precondition is what stops it, and it is the assertion to keep if this ever gets rewritten.
    for (const width of [390, 1280]) {
        await page.setViewportSize({ width, height: 1200 });
        await seedSession(page);
        await page.goto('/admin.html');
        await page.locator('#fieldMember').selectOption('C. Reen');
        await page.waitForSelector('.day-row', { timeout: 10000 });
        const badges = await page.evaluate(() => [...document.querySelectorAll('.day-row .col-base .shift-badge')]
            .map(b => ({ left: Math.round(b.getBoundingClientRect().left),
                         text: (b.textContent || '').replace(/\s+/g, ' ').trim() })));
        const texts = [...new Set(badges.map(b => b.text))];
        expect(texts.length,
            `@${width}px the week must hold badges of DIFFERENT widths, or one left edge is free — got ${texts.join(' | ')}`)
            .toBeGreaterThan(1);
        const lefts = [...new Set(badges.map(b => b.left))];
        expect(lefts, `@${width}px every badge starts at the same x — got ${lefts.join(', ')}`).toHaveLength(1);
    }
});

test('admin: the BASE ROSTER column shows the time, not just Early/Late', async ({ page }) => {
    // Owner report with a screenshot: "you can't see the default shift time as reference, only
    // early or late." The badge was the only thing on an untouched row, so the question an admin is
    // there to answer — what is this person rostered to work? — had no answer on screen.
    //
    // A WIRING test, deliberately. `getShiftBadge`'s option is unit-tested both ways; what only a
    // browser can show is that the week grid PASSES it, and that the time fits the row it lives in.
    //
    // THE MEMBER IS ON A FIXED LINE ON PURPOSE — DO NOT SWAP IT BACK FOR A ROTATING ONE (v22.97).
    // This used to read whatever week the real clock happened to land on, for a member on the
    // 20-week main roster — and FOUR of those twenty weeks are entirely SPARE. So the precondition
    // below was true four weeks in five and false the fifth, with nothing anywhere saying so: on
    // 6 Sep 2026 the rotation reached one and the suite went red on every engine at once, with no
    // code change behind it, which is indistinguishable from a real regression until you look.
    // `C. Reen` is `rosterType: 'fixed'` with no `rosterChanges` and no `startDate`, so their week
    // is the same seven days for ever — five 12:00-19:00 and two rest days. That is what lets the
    // count below be EXACT rather than a floor, and a floor is what hid the problem: `> 2` also
    // passes on the week that has three.
    //
    // AND THE WEEK IS AN ORDINARY ONE (test audit, 7 Nov 2026). The grid opens on today's week, and in
    // Christmas week one of those five days is 25 or 26 December, which the line is not rostered to
    // work — so from 21 to 27 Dec 2026 the count read 4, and every Christmas week after. Pinned to a
    // week with no bank holiday in it.
    await page.clock.setFixedTime(new Date('2026-11-03T09:00:00Z'));
    await page.setViewportSize({ width: 390, height: 900 });
    await seedSession(page);
    await page.goto('/admin.html');
    await page.locator('#fieldMember').selectOption('C. Reen');
    await page.waitForSelector('.day-row', { timeout: 10000 });

    const worked = await page.evaluate(() => [...document.querySelectorAll('.day-row')]
        .map((r) => {
            const b = r.querySelector('.shift-badge');
            const rect = b.getBoundingClientRect();
            return { text: b.innerText.replace(/\s+/g, ' ').trim(), aria: b.getAttribute('aria-label'),
                     right: rect.right, rowRight: r.getBoundingClientRect().right,
                     h: rect.height, rowH: r.getBoundingClientRect().height };
        })
        .filter(x => /badge/.test('') === false));

    const timed = worked.filter(x => /\d{2}:\d{2}-\d{2}:\d{2}/.test(x.text));
    expect(timed.length, 'C. Reen works Mon–Fri on a fixed line — five timed days, every week')
        .toBe(5);
    for (const b of timed) {
        expect(b.aria, 'the classification moves into the accessible name, it is not dropped')
            .toMatch(/^(Early|Late|Night) shift, \d{2}:\d{2} to \d{2}:\d{2}$/);
        expect(b.right, 'the wider badge must stay inside its row').toBeLessThanOrEqual(b.rowRight);
        expect(b.h, 'and must not wrap onto a second line — that would add ~14px to all seven rows')
            .toBeLessThan(28);
    }
    // A non-worked day keeps its word: REST has no time, and "Rest" IS the information.
    expect(worked.some(x => /REST/i.test(x.text) && !x.aria), 'rest days are untouched').toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth))
        .toBe(true);
});

test('admin: on a phone the bulk-bar pills share the chips\' left edge; the per-row pills stay centred', async ({ page }) => {
    // Polish round 2. The bulk bar is a 1 → 2 → 3 sequence whose step-1 chips start at the content
    // edge; the step-2 pills were centred, so their first row started ~39px in and a wrapped pill sat
    // alone mid-card. The per-row pills are CENTRED on phones by a separate decision (`.col-pills`
    // in admin.css, v22.22) and must not follow — both halves are asserted.
    await page.setViewportSize({ width: 390, height: 844 });
    await seedSession(page);
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    await expect(page.locator('#bulkBar')).toBeVisible();
    // Measured against the step's own left edge (its label), not the chips: whether the chips wrap
    // under "1 Tick days" or sit beside it depends on the engine's text metrics, and the pills wrap
    // under "2 Choose type" on every phone. Left-aligned, the first pill starts at that edge.
    const m = await page.evaluate(() => {
        const edge = document.querySelectorAll('.bulk-step-label')[1].getBoundingClientRect();
        const group = document.getElementById('bulkTypePills').getBoundingClientRect();
        const pill = document.querySelector('#bulkTypePills .type-pill-btn').getBoundingClientRect();
        return { edge: Math.round(edge.left), groupLeft: Math.round(group.left), pillLeft: Math.round(pill.left) };
    });
    expect(m.groupLeft, 'at 390px the pills wrap onto their own line under the step label').toBe(m.edge);
    expect(m.pillLeft, 'the first bulk pill starts at the step\'s left edge, not centred').toBe(m.edge);

    await page.locator('.week-panel .day-row .day-cb').first().check();
    const rowPills = page.locator('.week-panel .day-row.selected .col-pills').first();
    await expect(rowPills).toBeVisible();
    await expect(rowPills, 'the per-row pills stay centred on a phone').toHaveCSS('justify-content', 'center');
});

test('admin: selecting a pill with hours causes no horizontal blowout (touch layout)', async ({ page }) => {
    // 360px = the most common Android CSS width (1080 physical ÷ 3, e.g. Samsung) — the
    // width where the second-round residue (the nowrap bulk-time-group) actually clipped.
    await page.setViewportSize({ width: 360, height: 800 });
    await seedSession(page);
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });

    // The bulk path that reproduced the blowout: tick Mon–Fri, choose a bulk pill WITH
    // hours (reveals the nowrap bulk time inputs — the element that historically clipped),
    // apply (reveals per-row time inputs on five rows). 'Shift' rather than 'Other' since
    // v16.47 — Other is applied per-row, not in bulk (it needs a per-row flavour), so it is
    // no longer a bulk pill; any hours pill reproduces the same bulk-time-group layout.
    await page.locator('#bulkSelMonFri').click();
    await page.locator('#bulkTypePills .pill-shift').click();
    await page.locator('#bulkApplyBtn').click();
    // Also reveal the per-row "Other" sub-controls (flavour chips + optional times) on a
    // weekday row — the most width-hungry revealed control set, now reached only per-row.
    const otherPill = page.locator('.day-row .pill-other:not([disabled])').first();
    if (await otherPill.count()) await otherPill.click();
    await page.waitForTimeout(200);

    const m = await page.evaluate(() => {
        let max = 0, worst = '';
        document.querySelectorAll('body *').forEach(el => {
            const w = el.getBoundingClientRect().width;
            if (w > max) { max = w; worst = `${el.tagName}.${String(el.className).split(' ')[0]}`; }
        });
        return { max: Math.round(max), innerW: window.innerWidth, worst };
    });
    expect(m.max, `widest element ${m.worst} at ${m.max}px vs viewport ${m.innerW}px`)
        .toBeLessThanOrEqual(m.innerW + 2);
});

// The Other submenu opens only on demand, so the all-pages tap-target gate (which scans pages as they
// load) never measured it — and its flavour chips and RDW tick were ~20px tall on a phone.
test('admin: the Other submenu\'s chips and tick clear the 24px tap floor on touch @a11y', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile-chrome', 'a thumb, not a mouse');
    await page.setViewportSize({ width: 390, height: 844 });
    await seedSession(page);
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    const row = page.locator('.day-row').filter({ has: page.locator('.pill-other:not([disabled])') }).first();
    // A row's pills are offered once its day is ticked.
    await row.locator('.day-cb').check();
    await row.locator('.pill-other').click();
    const targets = row.locator('.other-opts .other-flavour-btn, .other-opts .other-rdw-label');
    await expect(targets.first()).toBeVisible();
    const heights = await targets.evaluateAll(els => els.map(e => [e.textContent.trim(), e.getBoundingClientRect().height]));
    expect(heights.length).toBeGreaterThan(1);
    for (const [label, h] of heights) expect(h, `"${label}" is ${h}px tall`).toBeGreaterThanOrEqual(24);
});


// ── ADMIN WEEK SWIPE ────────────────────────────────────────────────────────────────────────────
//
// Written BEFORE extracting the gesture into its own module (v21.89), because it had no
// behavioural coverage at all: 165 lines of pointer capture, transitions and timers driving a
// navigation staff use daily on a phone, and nothing that would notice if a refactor broke it.
//
// It is also the one surface with a documented history of being broken by a plausible change —
// CLAUDE.md carries two standing rules about it (Pointer Events not Touch Events; pointer capture
// on the grid, not the clip) — so "read it carefully" is exactly the assurance that has failed
// here before.
//
// The drag is a real pointer sequence rather than a synthetic event: the whole mechanism is the
// lazy capture that only starts once horizontal intent is confirmed, and dispatching a single
// event skips the thing under test.
async function dragWeek(page, dir) {
    // WAIT FOR THE PREVIOUS GESTURE TO SETTLE FIRST. A commit sets a cooldown that is released
    // only when the carousel animation finishes, so a second drag issued the moment the DATE
    // changes is correctly ignored — the date is written before the animation, deliberately, so
    // the label cannot lag the grid. The first version of this test dragged straight back and
    // read that as a broken swipe; it is the double-commit guard doing its job.
    //
    // The observable end of the gesture is the carousel panels being torn down in `restore()`.
    await page.waitForFunction(
        () => document.querySelectorAll('.week-carousel-panel').length === 0,
        null, { timeout: 5000 });
    // SCROLL IT INTO VIEW FIRST, then take a y inside BOTH the grid and the viewport. The grid is
    // 559px tall and starts 594px down a 727px-tall phone viewport, so its midpoint is off-screen —
    // `page.mouse` works in viewport coordinates, so the original midpoint drag was dispatched below
    // the window and hit nothing. It passed on desktop only because that layout happens to fit.
    await page.locator('#weekGrid').scrollIntoViewIfNeeded();
    const box = await page.locator('#weekGrid').boundingBox();
    const vh  = page.viewportSize().height;
    const top = Math.max(box.y, 0);
    const bot = Math.min(box.y + box.height, vh);
    const y   = (top + bot) / 2;
    expect(y, 'the drag must start inside the viewport').toBeGreaterThan(0);
    expect(y, 'the drag must start inside the viewport').toBeLessThan(vh);
    // Start well clear of the left edge — the handler deliberately ignores the first 24px so it
    // does not fight the iOS system back-swipe.
    const [from, to] = dir === 'next'
        ? [box.x + box.width - 30, box.x + 40]
        : [box.x + 40, box.x + box.width - 30];
    await page.mouse.move(from, y);
    await page.mouse.down();
    // Enough steps to clear the intent threshold and register velocity; a single jump reads as a
    // tap with a large delta and is correctly ignored.
    await page.mouse.move(to, y, { steps: 14 });
    await page.mouse.up();
}

test('admin: swiping the week grid moves a week, in both directions', async ({ page }) => {
    await seedSession(page, 'G. Miller');
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });

    const dateField = page.locator('#fieldDate');
    const start = await dateField.inputValue();
    expect(start, 'the grid should open on a week').toBeTruthy();

    await dragWeek(page, 'next');
    await expect
        .poll(() => dateField.inputValue(), { timeout: 5000 })
        .not.toBe(start);
    const forward = await dateField.inputValue();
    // Exactly one week, not two: the carousel commits a single panel per gesture, and a
    // double-commit is the failure a cooldown exists to prevent.
    expect(Math.round((Date.parse(forward) - Date.parse(start)) / 86400000)).toBe(7);

    await dragWeek(page, 'prev');
    await expect.poll(() => dateField.inputValue(), { timeout: 5000 }).toBe(start);
});

// Whole-app review, Oct 2026: a SWIPE brings in a panel built fresh with nothing ticked, and the bulk
// bar went on saying "5 days selected" about boxes that were no longer on screen. The arrows were
// always right — they redraw through renderWeekGrid, which recounts; the swipe settles without it.
test('admin: swiping to another week clears the bulk bar\'s "days selected" count', async ({ page }) => {
    await seedSession(page, 'G. Miller');
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    await page.locator('#bulkSelMonFri').click();
    await expect(page.locator('#bulkSelCount')).toHaveText(/days? selected/);
    const start = await page.locator('#fieldDate').inputValue();
    await dragWeek(page, 'next');
    await expect.poll(() => page.locator('#fieldDate').inputValue(), { timeout: 5000 }).not.toBe(start);
    await page.waitForFunction(() => document.querySelectorAll('.week-carousel-panel').length === 0, null, { timeout: 5000 });
    await expect(page.locator('#weekGrid .day-cb:checked')).toHaveCount(0);
    await expect(page.locator('#bulkSelCount')).toHaveText('');
});

test('admin: the week label follows the swipe, so the grid and its heading agree', async ({ page }) => {
    // The label is written on COMMIT, before the animation, precisely so it cannot lag the grid.
    // A heading naming one week above a grid showing another is the misreading this prevents.
    await seedSession(page, 'G. Miller');
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });

    const label = page.locator('#weekNavLabel');
    const before = await label.textContent();
    await dragWeek(page, 'next');
    await expect.poll(() => label.textContent(), { timeout: 5000 }).not.toBe(before);

    // And it agrees with the date field, which is the state everything else reads.
    //
    // AGREEMENT MEANS THE SAME WEEK, NOT THE SAME DAY. The label names the week's two BOUNDARY days
    // (Sunday–Saturday, `updateWeekNavLabel`), while `#fieldDate` holds a day INSIDE that week — so
    // asserting the label contains the field's own day-of-month is true only on the 2 days in 7
    // where they coincide. The first version of this test did exactly that, passed on the day it
    // was written, and failed the next morning against unchanged code.
    //
    // Derive the boundaries here and assert both. This checks the property the test is named for
    // without re-implementing the formatter's month-collapsing rule, which is the label's business.
    const iso = await page.locator('#fieldDate').inputValue();
    const inWeek = new Date(iso + 'T00:00:00');
    const sunday = new Date(inWeek);
    sunday.setDate(inWeek.getDate() - inWeek.getDay());
    const saturday = new Date(sunday);
    saturday.setDate(sunday.getDate() + 6);

    const text = await label.textContent();
    expect(text, `the heading should name the week containing ${iso}`)
        .toContain(String(sunday.getDate()));
    expect(text, `the heading should name the week containing ${iso}`)
        .toContain(String(saturday.getDate()));
});

// ── THE WEEK JUMP OPENS THE APP'S OWN CALENDAR (v23.38) ───────────────────────────────────────
//
// The rules are unit-tested (date-picker.test.mjs covers `monthCells`). What only a browser can
// answer is whether the label is WIRED to the picker at all — and that is the whole change, because
// until v23.38 tapping this label opened the OS date picker through an invisible `<input
// type="date">` laid over it. Both surfaces look identical in a screenshot of the closed control.
//
// It also proves the picker's CSS reaches this page. It lived in operations.css until this release
// and Admin does not load that file, so every rule would have silently not applied and the calendar
// would have rendered as bare buttons — the exact fault the module exists to fix. Asserting the
// panel has a real painted box is what sees that; `toBeVisible` would not.
test('admin: tapping the week label opens the app calendar, and picking a day moves the week',
    async ({ page }) => {
    await seedSession(page, 'G. Miller');
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });

    const before = await page.locator('#fieldDate').inputValue();
    await page.locator('#weekNavLabel').click();

    const panel = page.locator('.dp-content');
    await expect(panel).toBeVisible();
    // The picker is styled here, not just present. An unstyled .dp-content is transparent and
    // padless, which is what a missing stylesheet looks like.
    const paint = await panel.evaluate(el => {
        const cs = getComputedStyle(el);
        return { bg: cs.backgroundColor, pad: parseFloat(cs.paddingTop) };
    });
    expect(paint.bg, 'the picker panel should have a painted surface')
        .not.toBe('rgba(0, 0, 0, 0)');
    expect(paint.pad, 'the picker panel should carry its own padding').toBeGreaterThan(8);

    // Pick a day that is not the one already selected, so the assertion cannot pass by standing
    // still. Every visible cell is in the month `#fieldDate` already sits in.
    const day = page.locator('.dp-day:not(.dp-off):not(.dp-sel)').first();
    const iso = await day.getAttribute('data-iso');
    await day.click();

    await expect(panel).toBeHidden();
    await expect.poll(() => page.locator('#fieldDate').inputValue(), { timeout: 5000 }).toBe(iso);
    expect(iso).not.toBe(before);

    // And the rest of the page followed: the label names the week containing the picked day. That
    // is the `change` event the OS picker used to fire, still reaching the same listeners.
    const picked = new Date(iso + 'T00:00:00');
    const sunday = new Date(picked);
    sunday.setDate(picked.getDate() - picked.getDay());
    const saturday = new Date(sunday);
    saturday.setDate(sunday.getDate() + 6);
    const text = await page.locator('#weekNavLabel').textContent();
    expect(text, `the heading should name the week containing ${iso}`)
        .toContain(String(sunday.getDate()));
    expect(text, `the heading should name the week containing ${iso}`)
        .toContain(String(saturday.getDate()));
});

// THE WEEK JUMP IS A WEEK PICKER (polish round 2). Admin's week runs Sunday–Saturday, and its picker
// laid the month out Monday-first and highlighted one day — so the week a tap would open was never
// what the grid showed. `week: true` makes it Sunday-first and bands the week. Other date fields keep
// the Monday-first single-day grid: Operations' is checked here too, from the same shared overlay.
test('admin: "Jump to a week" is Sunday-first and bands the week; other date pickers are unchanged',
    async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-09-16T09:00:00Z'));   // Wed 16 Sep 2026
    await seedSession(page, 'G. Miller');
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    await page.locator('#weekNavLabel').click();
    await expect(page.locator('.dp-content')).toBeVisible();

    expect((await page.locator('.dp-dow').allInnerTexts()).join(''), 'Sunday is the first column')
        .toBe('SMTWTFS');
    // The chosen week is banded: exactly its seven days, Sun 13 – Sat 19 Sep.
    const band = await page.locator('.dp-day.dp-inweek').evaluateAll(els => els.map(e => e.getAttribute('data-iso')));
    expect(band).toEqual(['2026-09-13', '2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19']);
    // …and drawn as a band, one ROW of the grid: all seven share a top edge, Sunday leftmost.
    const tops = await page.locator('.dp-day.dp-inweek').evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().top)));
    expect(new Set(tops).size, 'the week is one row').toBe(1);

    // Hovering another day bands THAT day's week.
    await page.locator('.dp-day[data-iso="2026-09-23"]').hover();
    const hovered = await page.locator('.dp-day.dp-hoverweek').evaluateAll(els => els.map(e => e.getAttribute('data-iso')));
    expect(hovered).toEqual(['2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26']);
    await page.keyboard.press('Escape');

    // The shared overlay without the option: Operations' date fields keep Monday-first, single-day.
    await page.addInitScript(() => { /** @type {any} */ (window).__E2E = { authUser: true, docs: [] }; });
    await page.goto('/operations.html');
    await page.evaluate(() => document.getElementById('circularUploadBody')?.classList.add('open'));
    const trigger = page.locator('#circularUploadBody .date-trigger');
    await expect(trigger).toBeVisible({ timeout: 10000 });
    await trigger.click();
    await expect(page.locator('.dp-content')).toBeVisible();
    expect((await page.locator('.dp-dow').allInnerTexts()).join('')).toBe('MTWTFSS');
    await expect(page.locator('.dp-day.dp-inweek')).toHaveCount(0);
});

test('admin: the week arrows and the swipe move the same state', async ({ page }) => {
    // The buttons live inside the gesture's own closure so they share its cooldown. Extracting the
    // gesture must not leave them wired to a different notion of "which week".
    await seedSession(page, 'G. Miller');
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });

    const dateField = page.locator('#fieldDate');
    const start = await dateField.inputValue();
    await page.locator('#nextWeekBtn').click();
    await expect.poll(() => dateField.inputValue(), { timeout: 5000 }).not.toBe(start);
    const afterBtn = await dateField.inputValue();

    await dragWeek(page, 'prev');
    await expect.poll(() => dateField.inputValue(), { timeout: 5000 }).toBe(start);
    expect(Math.round((Date.parse(afterBtn) - Date.parse(start)) / 86400000)).toBe(7);
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
        const remaining = Number(await page.locator('#alBannerRemaining').textContent());
        expect(remaining, 'the fixture must put the member OVER limit, or this tests nothing')
            .toBeLessThan(0);
        const warn = page.locator('#alBannerWarn');
        await expect(warn).toBeVisible();
        await expect(warn).toHaveText(`${Math.abs(remaining)} over limit`);

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

test('admin: the AL preview names a Spare day and says it costs one day of leave', async ({ page }) => {
    // THE WIRING, not the helper. `spareShiftNote` has its own unit test, and a unit test is exactly
    // what would NOT have caught the defect this replaces: the broken sentence lived in a template
    // literal inside `admin-al.js`, which imports Firebase, so nothing in Node could render it and
    // nothing did — it shipped ungrammatical from v11.35 to v23.72 and was found by the owner
    // reading it off a phone. This drives the real card and reads the real banner.
    await seedSession(page, 'G. Miller');
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });

    // The note renders only for CEA/CES, and only on a day whose BASE shift is SPARE — so the date
    // is found from the roster rather than written down here, where a pattern edit would silently
    // turn it into an ordinary working day and leave this test asserting nothing.
    //
    // ── AND NEVER A SUNDAY, WHICH THIS SEARCH LEARNED THE HARD WAY (v24.10) ─────────────────────
    //
    // `annual_leave` is in `SUNDAY_FORBIDDEN_TYPES`, so a Sunday costs no entitlement however the
    // base roster reads: the preview correctly answers "0 days of Annual Leave … (+ 1 rest day
    // skipped)" and the assertion below is unsatisfiable. Nothing here excluded one, so the pick
    // was only ever right by luck — and the luck ran out on 19 Sep 2026, when the first CEA with a
    // Spare day in the next 200 days became L. Springer on Sunday 18 October.
    //
    // A DATE-DRIVEN SEARCH IS A TIME BOMB WITH NO FUSE VISIBLE IN THE DIFF. It is still the right
    // shape — a hardcoded date rots the moment a pattern is edited, which is what the comment above
    // is about — but the filter has to encode every rule the surface under test obeys, not just the
    // one the test is named after. This found it: Chromium and WebKit failed identically, on a
    // branch that touched neither Admin nor annual leave.
    const pick = await page.evaluate(async () => {
        const rd = await import('./roster-data.js');
        const today = new Date(); today.setHours(0, 0, 0, 0);
        for (const m of rd.teamMembers) {
            if (m.hidden || m.managerOnly) continue;
            if (m.role !== 'CEA' && m.role !== 'CES') continue;
            for (let i = 1; i <= 200; i++) {
                const d = new Date(today); d.setDate(d.getDate() + i);
                const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                // `isSunday` takes the ISO STRING, not a Date — handing it a Date makes it a silent
                // no-op that filters nothing, which is how the first version of this fix "passed".
                if (rd.isSunday(iso)) continue;                     // AL is refused on a Sunday
                if (rd.getBaseShift(m, d) !== 'SPARE') continue;
                return {
                    name: m.name,
                    iso,
                    monthsAhead: (d.getFullYear() - today.getFullYear()) * 12 + (d.getMonth() - today.getMonth()),
                };
            }
        }
        return null;
    });
    expect(pick, 'no CEA/CES member has a NON-SUNDAY Spare day in the next 200 days — that is a roster problem, not a copy one')
        .not.toBeNull();
    // The filter above has to be seen to have worked. A Sunday reaching here means the day costs no
    // entitlement and every assertion below is unsatisfiable — which is the failure this test spent
    // a release reporting as a copy bug.
    expect(new Date(`${/** @type {any} */ (pick).iso}T12:00:00`).getDay(),
        `the search returned a Sunday (${/** @type {any} */ (pick).iso}) — AL cannot be booked on one`)
        .not.toBe(0);

    await page.locator('#fieldMember').selectOption(/** @type {any} */ (pick).name);
    await page.locator('#alToggleHeader').click();
    await expect(page.locator('#alRangePicker')).toBeVisible();

    for (let i = 0; i < /** @type {any} */ (pick).monthsAhead; i++) {
        await page.locator('#alRpNext').click();
        await page.waitForTimeout(60);
    }
    // Twice on the same cell is a one-day range: the first click sets the start, the second the end.
    const cell = page.locator(`#alRpGrid .rp-day[data-iso="${/** @type {any} */ (pick).iso}"]`);
    await expect(cell, 'the picker did not reach the month holding the Spare day').toHaveCount(1);
    await cell.click();
    await cell.click();

    const preview = page.locator('#alPreview');
    await expect(preview).toContainText('1 day of Annual Leave');   // v23.79 wording — see the range test below
    // What the owner ruled on 14 Sep 2026: a day is a day.
    await expect(preview).toContainText('This is a Spare day');
    await expect(preview).toContainText('It still uses 1 day of annual leave.');

    const text = (await preview.textContent()) ?? '';
    expect(text, 'the singular branch shipped as "1 of these day is" for four months').not.toMatch(/these day\b/);
    expect(text, 'a one-day booking has no "these" to be one of').not.toMatch(/of these/);
    expect(text, 'the hours claim is wrong and was removed — the app charges whole days')
        .not.toMatch(/hours|more than 1 AL day/i);
});

// OWNER-REPORTED (v24.44): a Spare week that a roster upload had turned into real shifts was still
// called Spare when one of those days was booked off — "the shift not yet assigned", about a day
// whose shift had been. The note read the BASE roster; it must read what the Calendar shows.
test('admin: a Spare day a roster upload has since assigned is not called Spare', async ({ page }) => {
    await seedSession(page, 'G. Miller');
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    // Same search as the test above, and for the same reasons (never a Sunday, never a fixed date).
    const pick = await page.evaluate(async () => {
        const rd = await import('./roster-data.js');
        const today = new Date(); today.setHours(0, 0, 0, 0);
        for (const m of rd.teamMembers) {
            if (m.hidden || m.managerOnly || (m.role !== 'CEA' && m.role !== 'CES')) continue;
            for (let i = 1; i <= 200; i++) {
                const d = new Date(today); d.setDate(d.getDate() + i);
                const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                if (rd.isSunday(iso) || rd.getBaseShift(m, d) !== 'SPARE') continue;
                return { name: m.name, iso, monthsAhead: (d.getFullYear() - today.getFullYear()) * 12 + (d.getMonth() - today.getMonth()) };
            }
        }
        return null;
    });
    expect(pick, 'no CEA/CES member has a non-Sunday Spare day in the next 200 days').not.toBeNull();
    const p = /** @type {any} */ (pick);
    // The roster upload's write: a real shift over the Spare day. Seeded, then the page reloaded so
    // the AL card reads it.
    await page.addInitScript(({ name, iso }) => {
        /** @type {any} */ (window).__E2E = /** @type {any} */ (window).__E2E || {};
        /** @type {any} */ (window).__E2E.docs = [{ id: 'ri1', memberName: name, date: iso,
            value: '06:00-14:00', type: 'shift', source: 'roster_import' }];
    }, { name: p.name, iso: p.iso });
    await page.reload();
    await page.waitForSelector('.day-row', { timeout: 10000 });

    await page.locator('#fieldMember').selectOption(p.name);
    await page.locator('#alToggleHeader').click();
    await expect(page.locator('#alRangePicker')).toBeVisible();
    for (let i = 0; i < p.monthsAhead; i++) { await page.locator('#alRpNext').click(); await page.waitForTimeout(60); }
    const cell = page.locator(`#alRpGrid .rp-day[data-iso="${p.iso}"]`);
    await cell.click();
    await cell.click();

    const preview = page.locator('#alPreview');
    await expect(preview).toContainText('1 day of Annual Leave');
    await expect(preview).not.toContainText('Spare');
});

test('admin: the AL and Absence cards carry no member dropdown of their own', async ({ page }) => {
    // OWNER-REPORTED, 14 Sep 2026. `#alMember` and `#sickMember` are `hidden` value holders — the
    // member is chosen ONCE in the top bar — but v23.33 put both in the `initSelectSheets` list, and
    // `enhanceSelect` builds a NEW element for the trigger, which inherited the classes and not the
    // `hidden`. Each card grew a second, fully operable member picker. Picking a name in it moved
    // `alMember.value`, WHICH IS WHAT THE SAVE WRITES TO, while the top bar, "Recording for", the AL
    // banner, the week grid and Saved Changes all stayed on the previous member: leave recorded
    // against one person under another person's name and entitlement figures.
    //
    // `select-sheet-parity.test.mjs` refuses a hidden id in an enhancement list. It cannot see the
    // other half — that `enhanceSelect` mirrors `hidden` onto its trigger is a runtime property of
    // an element, so deleting that line leaves every static test green. This is the half that fails.
    await seedSession(page, 'G. Miller');
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    await page.locator('#fieldMember').selectOption('G. Miller');

    // Open BOTH cards — the Absence one carried the identical phantom, one card further down.
    await page.locator('#alToggleHeader').click();
    await page.locator('#sickToggleHeader').click();
    await expect(page.locator('#alBanner')).toBeVisible();

    for (const id of ['alMemberTrigger', 'sickMemberTrigger']) {
        await expect(page.locator(`#${id}`), `${id} is a phantom control over a hidden select`)
            .toBeHidden();
    }
    // ONE member control on the page, which is the whole point of the top bar.
    await expect(page.locator('.fieldpick:visible').filter({ hasText: 'G. Miller' }))
        .toHaveCount(1);
});

test('admin: AL on a rest day asks whether it was a swap, and will not save unanswered', async ({ page }) => {
    // OWNER-REPORTED, 14 Sep 2026. Leave on a base-roster rest day costs nothing unless the member
    // was SWAPPED onto it, and the app decided that silently — the AL card skipped such days, the
    // week grid wrote them costing nothing. Three of one member's days were missing from her balance
    // and the only way to find out was to compare against the depot's workbook by hand.
    //
    // The two rules are the owner's: ask ONLY when a day is affected, and REQUIRE an answer. The
    // second is a save-path property — `al-swapped-days.test.mjs` can prove which days qualify, but
    // only this can prove the button stays disabled — which is the half that makes it non-silent.
    await seedSession(page, 'G. Miller');
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });

    // A member and a range found from the roster, not written down: a pattern edit must not be able
    // to turn this into a test of nothing.
    // THE RANGE MUST HOLD A WORKING DAY *AND* A REST DAY, and that is not fussiness. A rest-day-only
    // range is unsaveable either way — nothing to write — so it cannot tell "blocked because
    // unanswered" from "blocked because empty". Deleting the unanswered guard left an earlier
    // version of this test green; with a working day in the range, only the guard can disable Save.
    const pick = await page.evaluate(async () => {
        const [rd, ou, cl] = await Promise.all([import('./roster-data.js'), import('./override-utils.js'), import('./christmas-leave.js')]);
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const iso = (/** @type {Date} */ d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        // NOT CHRISTMAS DAY OR BOXING DAY (test audit, 7 Nov 2026). getBaseShift makes both a rest
        // day for everyone, but leave there never costs a day, so the swap question is never asked.
        // From 18 to 26 December the first match was a working 24th followed by the 25th, and this
        // test and the five week-grid ones below all failed — in the week the release gate is needed
        // most. Proved with the clock pinned to 21 Dec; the same skip is in each search below.
        const rest = (/** @type {any} */ m, /** @type {Date} */ d) =>
            d.getDay() !== 0 && !cl.isChristmasClosureDate(iso(d)) && ou.isRestShift(rd.getBaseShift(m, d));
        const work = (/** @type {any} */ m, /** @type {Date} */ d) =>
            d.getDay() !== 0 && !ou.isRestShift(rd.getBaseShift(m, d));
        for (const m of rd.teamMembers) {
            if (m.hidden || m.managerOnly) continue;
            for (let i = 1; i <= 120; i++) {
                const a = new Date(today); a.setDate(a.getDate() + i);
                const b = new Date(a);     b.setDate(b.getDate() + 1);
                if (!work(m, a) || !rest(m, b)) continue;
                if (a.getMonth() !== b.getMonth()) continue;   // keep both cells on one picker page
                return { name: m.name, work: iso(a), rest: iso(b),
                         monthsAhead: (a.getFullYear() - today.getFullYear()) * 12 + (a.getMonth() - today.getMonth()) };
            }
        }
        return null;
    });
    expect(pick, 'no member has a working day followed by a rest day in the next 120 days').not.toBeNull();
    const p = /** @type {any} */ (pick);

    await page.locator('#fieldMember').selectOption(p.name);
    await page.locator('#alToggleHeader').click();
    await expect(page.locator('#alRangePicker')).toBeVisible();
    for (let i = 0; i < p.monthsAhead; i++) { await page.locator('#alRpNext').click(); await page.waitForTimeout(60); }

    await page.locator(`#alRpGrid .rp-day[data-iso="${p.work}"]`).click();
    // BY KEYBOARD, and focus must survive it (whole-app review, Oct 2026): every pick rebuilds the
    // grid, which used to destroy the focused day and drop focus to <body>.
    const restCell = page.locator(`#alRpGrid .rp-day[data-iso="${p.rest}"]`);
    await restCell.focus();
    await page.keyboard.press('Enter');
    await expect(restCell, 'the picked day keeps keyboard focus').toBeFocused();

    const ask  = page.locator('#alPreview .swapday-ask');
    const save = page.locator('#alSaveBtn');
    await expect(ask, 'a rest day in the range must raise the question').toBeVisible();
    await expect(ask).toContainText('rest day');
    // THE DECISIVE ASSERTION: there IS a working day to record, so the only thing that can be
    // holding Save is the unanswered question.
    await expect(save, 'unanswered means unsaveable — no default').toBeDisabled();

    const freeBtn = page.locator(`.swapday-opt[data-answer="no"][data-date="${p.rest}"]`);
    await freeBtn.focus();
    await page.keyboard.press('Enter');
    await expect(freeBtn).toHaveAttribute('aria-pressed', 'true');
    await expect(freeBtn, 'the answer keeps keyboard focus through the rebuild').toBeFocused();
    await expect(save, 'answered — the working day is recordable').toBeEnabled();

    // The other answer, and the pressed state moving with it.
    await page.locator(`.swapday-opt[data-answer="yes"][data-date="${p.rest}"]`).click();
    await expect(page.locator(`.swapday-opt[data-answer="yes"][data-date="${p.rest}"]`)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator(`.swapday-opt[data-answer="no"][data-date="${p.rest}"]`)).toHaveAttribute('aria-pressed', 'false');
    await expect(save).toBeEnabled();
});

test('admin: a range with no rest days asks nothing at all', async ({ page }) => {
    // The owner's rule 1, and the reason it matters: a question on every booking would be noise, and
    // noise is how a question stops being read. No affected day, no block.
    await seedSession(page, 'G. Miller');
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });

    const pick = await page.evaluate(async () => {
        const [rd, ou] = await Promise.all([import('./roster-data.js'), import('./override-utils.js')]);
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const iso = (/** @type {Date} */ d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        for (const m of rd.teamMembers) {
            if (m.hidden || m.managerOnly) continue;
            for (let i = 1; i <= 120; i++) {
                const a = new Date(today); a.setDate(a.getDate() + i);
                if (a.getDay() === 0 || ou.isRestShift(rd.getBaseShift(m, a))) continue;
                return { name: m.name, work: iso(a),
                         monthsAhead: (a.getFullYear() - today.getFullYear()) * 12 + (a.getMonth() - today.getMonth()) };
            }
        }
        return null;
    });
    expect(pick).not.toBeNull();
    const p = /** @type {any} */ (pick);

    await page.locator('#fieldMember').selectOption(p.name);
    await page.locator('#alToggleHeader').click();
    for (let i = 0; i < p.monthsAhead; i++) { await page.locator('#alRpNext').click(); await page.waitForTimeout(60); }
    const cell = page.locator(`#alRpGrid .rp-day[data-iso="${p.work}"]`);
    await cell.click();
    await cell.click();

    // "1 day of Annual Leave", not "1 working day" (v23.79): the preview describes what the save
    // will RECORD, not what the roster says about the date. The old wording read as a count of
    // working days and was computed like one, which is how it came to say "rest day skipped" about
    // a day the admin had just declared swapped.
    await expect(page.locator('#alPreview')).toContainText('1 day of Annual Leave');
    await expect(page.locator('#alPreview'), 'nothing is skipped in a range with no rest days')
        .not.toContainText('skipped');
    await expect(page.locator('#alPreview .swapday-ask'), 'no rest day, no question').toHaveCount(0);
    await expect(page.locator('#alSaveBtn'), 'an ordinary booking is unaffected').toBeEnabled();
});

test('admin: the week grid asks the swap question too, and refuses to save it unanswered', async ({ page }) => {
    // THE OTHER DOOR, and the one the reported defect actually came through. The AL card skipped rest
    // days; the week grid WROTE the leave and let it cost nothing. Fixing only the card would have
    // left the original route silent — "the rule tested, the wiring not", in product form.
    await seedSession(page, 'G. Miller');
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });

    // Find a member with a rest day in the week the grid is showing, from the roster rather than a
    // written-down date.
    const target = await page.evaluate(async () => {
        const [rd, ou, cl] = await Promise.all([import('./roster-data.js'), import('./override-utils.js'), import('./christmas-leave.js')]);
        const rows = [...document.querySelectorAll('.day-row')].map(r => /** @type {any} */ (r).dataset.date);
        for (const m of rd.teamMembers) {
            if (m.hidden || m.managerOnly) continue;
            for (const d of rows) {
                if (!d) continue;
                const dt = new Date(d + 'T00:00:00');
                if (dt.getDay() === 0) continue;               // a Sunday is a different rule entirely
                if (cl.isChristmasClosureDate(d)) continue;   // never asked about — see the first swap test
                if (ou.isRestShift(rd.getBaseShift(m, dt))) return { name: m.name, date: d };
            }
        }
        return null;
    });
    expect(target, 'no member has a rest day in the displayed week').not.toBeNull();
    const t = /** @type {any} */ (target);

    await page.locator('#fieldMember').selectOption(t.name);
    await waitForReadsToLand(page, `${t.name}'s records never answered`);   // not a 400ms guess (test audit, 7 Nov 2026)
    const row = page.locator(`.day-row[data-date="${t.date}"]`);
    await expect(row).toHaveCount(1);

    // The question is hidden until AL is the chosen type — it is a question about annual leave.
    const ask = row.locator('.col-al-swap');
    await expect(ask, 'nothing is asked before a type is picked').toBeHidden();
    await clickInView(row.locator('.type-pill-btn[data-type="annual_leave"]'));
    await expect(ask, 'AL on a rest-day row must ask').toBeVisible();

    // Unanswered → the save refuses THIS ROW by name rather than writing a day that costs nothing.
    await clickInView(page.locator('#saveBtn'));
    await expect(row).toHaveClass(/row-error/);
    await expect(page.locator('#weekGridFeedback, .feedback').filter({ hasText: 'swapped working day' }).first())
        .toBeVisible();

    // Answering clears the refusal.
    await clickInView(row.locator('.al-swap-btn[data-swap="no"]'));
    await expect(row.locator('.al-swap-btn[data-swap="no"]')).toHaveAttribute('aria-pressed', 'true');

    // Switching away from AL forgets the answer — it described a booking that no longer exists.
    await clickInView(row.locator('.type-pill-btn[data-type="rdw"]'));
    await expect(ask).toBeHidden();
    await clickInView(row.locator('.type-pill-btn[data-type="annual_leave"]'));
    await expect(row.locator('.al-swap-btn[data-swap="no"]'), 'a stale answer must not survive a type change')
        .toHaveAttribute('aria-pressed', 'false');
});

test('admin: the save refuses an unanswered rest day even when the row never asked (v24.11)', async ({ page }) => {
    // THE STALE-FLAG CASE, and the reason the decision moved into `admin-al-week-save.js`.
    //
    // The refusal above reads `row.dataset.alSwapAsk`, which `renderWeekGrid` writes ONCE per row.
    // The planner reads `buildMemberDateMap` at SAVE time. Those two diverge whenever the override
    // cache changes without a re-render — which the AL/absence range delete does deliberately while
    // edits are staged (v16.82), so deleting an AL that carried `replacedType: 'shift'` from a base
    // rest day leaves a row that IS asked with no question on screen and nothing to answer.
    //
    // Staging that whole sequence here would test the sequence rather than the rule. Clearing the
    // dataset flag reproduces exactly the divergence it creates — the row believes no question
    // applies, the record says one does — and then drives the REAL save handler. Before the fix the
    // day was written and `consuming` excluded it: leave recorded that cost nothing.
    await seedSession(page, 'G. Miller');
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });

    const target = await page.evaluate(async () => {
        const [rd, ou, cl] = await Promise.all([import('./roster-data.js'), import('./override-utils.js'), import('./christmas-leave.js')]);
        const rows = [...document.querySelectorAll('.day-row')].map(r => /** @type {any} */ (r).dataset.date);
        for (const m of rd.teamMembers) {
            if (m.hidden || m.managerOnly) continue;
            for (const d of rows) {
                if (!d) continue;
                const dt = new Date(d + 'T00:00:00');
                if (dt.getDay() === 0) continue;               // Sundays are refused for a different reason
                if (cl.isChristmasClosureDate(d)) continue;   // never asked about — see the first swap test
                if (ou.isRestShift(rd.getBaseShift(m, dt))) return { name: m.name, date: d };
            }
        }
        return null;
    });
    expect(target, 'no member has a rest day in the displayed week').not.toBeNull();
    const t = /** @type {any} */ (target);

    await page.locator('#fieldMember').selectOption(t.name);
    await waitForReadsToLand(page, `${t.name}'s records never answered`);   // not a 400ms guess (test audit, 7 Nov 2026)
    const row = page.locator(`.day-row[data-date="${t.date}"]`);
    await expect(row).toHaveCount(1);

    await clickInView(row.locator('.type-pill-btn[data-type="annual_leave"]'));
    await expect(row.locator('.col-al-swap'), 'the row asks normally').toBeVisible();

    // Now make the row believe it was never asked — the stale flag, reproduced.
    await page.evaluate((date) => {
        const r = /** @type {any} */ (document.querySelector(`.day-row[data-date="${date}"]`));
        delete r.dataset.alSwapAsk;
        const ask = /** @type {any} */ (r.querySelector('.col-al-swap'));
        if (ask) ask.hidden = true;
    }, t.date);
    await expect(row.locator('.col-al-swap'), 'no question is on screen now').toBeHidden();

    await clickInView(page.locator('#saveBtn'));

    // The planner refuses on its own, and the row is marked the same way the per-row check marks it.
    await expect(row, 'the day must be named, not written').toHaveClass(/row-error/);
    await expect(page.locator('#weekGridFeedback, .feedback').filter({ hasText: 'swapped working day' }).first())
        .toBeVisible();
});

test('admin: a skip-only save leaves the row showing the record that is still there (v23.89)', async ({ page }) => {
    // FOUND IN THE v23.88 REGRESSION READ, not by a failing test. When every staged day resolves to
    // "rest day — free" there is nothing to commit, so the save reports and returns early — and that
    // early return called `resetStagedRows()` without the re-render the normal path does afterwards.
    // `resetStagedRows` only DEACTIVATES a row; it does not restore what a prefilled row was showing.
    // So a rest day that already held an ABSENCE came back blank, and the one thing the receipt had
    // just promised — that nothing was recorded and nothing was removed — was contradicted by the
    // grid underneath it.
    await seedSession(page, 'G. Miller');
    await page.addInitScript(() => {
        /** @type {any} */ (window).__E2E = { ...(/** @type {any} */ (window).__E2E || {}), authUser: true };
    });
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });

    const target = await page.evaluate(async () => {
        const [rd, ou, cl] = await Promise.all([import('./roster-data.js'), import('./override-utils.js'), import('./christmas-leave.js')]);
        const rows = [...document.querySelectorAll('.day-row')].map(r => /** @type {any} */ (r).dataset.date);
        for (const m of rd.teamMembers) {
            if (m.hidden || m.managerOnly) continue;
            for (const d of rows) {
                if (!d) continue;
                const dt = new Date(d + 'T00:00:00');
                if (dt.getDay() === 0) continue;
                if (cl.isChristmasClosureDate(d)) continue;   // never asked about — see the first swap test
                if (ou.isRestShift(rd.getBaseShift(m, dt))) return { name: m.name, date: d };
            }
        }
        return null;
    });
    expect(target, 'no member has a rest day in the displayed week').not.toBeNull();
    const t = /** @type {any} */ (target);

    // An ABSENCE already on that rest day. It is what the row is prefilled with, and it is what must
    // still be there afterwards — the save is told to record leave and answers that it recorded none.
    await page.addInitScript((row) => {
        /** @type {any} */ (window).__E2E = { ...(/** @type {any} */ (window).__E2E || {}), docs: [row] };
    }, { id: 'sick-1', memberName: t.name, date: t.date, type: 'sick', value: 'SICK', note: '', source: 'manual' });
    await page.goto('/admin.html');
    await page.locator('#fieldMember').selectOption(t.name);
    await waitForReadsToLand(page, `${t.name}'s records never answered`);   // not a 400ms guess (test audit, 7 Nov 2026)

    const row = page.locator(`.day-row[data-date="${t.date}"]`);
    await expect(row.locator('.type-pill-btn[data-type="sick"]'), 'the row starts prefilled with the absence')
        .toHaveAttribute('aria-pressed', 'true');

    await clickInView(row.locator('.type-pill-btn[data-type="annual_leave"]'));
    await clickInView(row.locator('.al-swap-btn[data-swap="no"]'));
    await clickInView(page.locator('#saveBtn'));

    await expect(page.locator('.feedback, #weekGridFeedback').filter({ hasText: 'no leave recorded' }).first())
        .toBeVisible();
    // Nothing was written…
    const writes = await page.evaluate(() => (/** @type {any} */ (window).__E2E?.batchWrites || []));
    expect(writes.filter((/** @type {any} */ w) => w.date === t.date), 'nothing may be written for a free rest day')
        .toHaveLength(0);
    // …and nothing was removed, which the row has to keep SAYING.
    await expect(page.locator(`.day-row[data-date="${t.date}"] .type-pill-btn[data-type="sick"]`),
        'the absence is still on record, so the row must still show it').toHaveAttribute('aria-pressed', 'true');
});

test('admin: a rest day that ALREADY holds leave is not reported as "no leave recorded" (v23.93)', async ({ page }) => {
    // THE WIRING HALF of admin-al-week-save.test.mjs's legacy-data block (external review of v23.92).
    // The pure test proves the planner and the receipt builder agree; only this proves the page
    // actually passes `keptLeave` from one to the other. Deleting that argument at either call site
    // leaves every unit test green — which is the seam this repo keeps naming.
    //
    // The record seeded here is the LEGACY shape: annual leave on a base rest day with no
    // `replacedType`, which is what the week grid wrote before v23.88 and what the swap question
    // therefore re-asks about.
    await seedSession(page, 'G. Miller');
    await page.addInitScript(() => {
        /** @type {any} */ (window).__E2E = { ...(/** @type {any} */ (window).__E2E || {}), authUser: true };
    });
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });

    const target = await page.evaluate(async () => {
        const [rd, ou, cl] = await Promise.all([import('./roster-data.js'), import('./override-utils.js'), import('./christmas-leave.js')]);
        const rows = [...document.querySelectorAll('.day-row')].map(r => /** @type {any} */ (r).dataset.date);
        for (const m of rd.teamMembers) {
            if (m.hidden || m.managerOnly) continue;
            for (const d of rows) {
                if (!d) continue;
                const dt = new Date(d + 'T00:00:00');
                if (dt.getDay() === 0) continue;               // Sundays are a different rule entirely
                if (cl.isChristmasClosureDate(d)) continue;   // never asked about — see the first swap test
                if (ou.isRestShift(rd.getBaseShift(m, dt))) return { name: m.name, date: d };
            }
        }
        return null;
    });
    expect(target, 'no member has a rest day in the displayed week').not.toBeNull();
    const t = /** @type {any} */ (target);

    await page.addInitScript((row) => {
        /** @type {any} */ (window).__E2E = { ...(/** @type {any} */ (window).__E2E || {}), docs: [row] };
    }, { id: 'legacy-al', memberName: t.name, date: t.date, type: 'annual_leave', value: 'AL', note: '', source: 'manual' });
    await page.goto('/admin.html');
    await page.locator('#fieldMember').selectOption(t.name);
    await waitForReadsToLand(page, `${t.name}'s records never answered`);   // not a 400ms guess (test audit, 7 Nov 2026)

    const row = page.locator(`.day-row[data-date="${t.date}"]`);
    await expect(row.locator('.type-pill-btn[data-type="annual_leave"]'), 'the row starts prefilled with the leave')
        .toHaveAttribute('aria-pressed', 'true');

    // RE-STAGING IS TWO TAPS, AND THE FIRST CUT OF THIS TEST GOT IT WRONG — worth recording,
    // because the wrong version fails in a way that looks like the feature is broken. Tapping the
    // ALREADY-PRESSED pill DEACTIVATES the row and stages a REMOVAL, so the save reported "1 change
    // saved … removed" and never reached the swap question at all. An untouched prefilled row is
    // not collected either (`prefilled-existing`). The reachable path is to leave the type and come
    // back to it: that re-selects annual leave, reveals the question (`alSwapAsk`), and stages the
    // row WITH its `existingId` — which is the state this whole test is about.
    await clickInView(row.locator('.type-pill-btn[data-type="sick"]'));
    await clickInView(row.locator('.type-pill-btn[data-type="annual_leave"]'));
    await expect(row.locator('.col-al-swap'), 'the swap question must be asked on a legacy record')
        .toBeVisible();
    await clickInView(row.locator('.al-swap-btn[data-swap="no"]'));
    await clickInView(page.locator('#saveBtn'));

    // The grid's own line by id: `.feedback` first-in-the-page became the bulk bar's refusal slot when
    // that moved beside the bar (desktop audit, Nov 2026), and it sits above this one.
    const feedback = page.locator('#formFeedback');
    await expect(feedback, 'the receipt must say the existing leave was left alone')
        .toContainText(/left as it is/);
    await expect(feedback, 'and must not use the wording for a day that is genuinely clear')
        .not.toContainText('no leave recorded');

    // …and the three layers still agree: nothing written, nothing deleted, the record still drawn.
    const writes = await page.evaluate(() => (/** @type {any} */ (window).__E2E?.batchWrites || []));
    expect(writes.filter((/** @type {any} */ w) => w.date === t.date),
        'answering free must not write leave').toHaveLength(0);
    await expect(row.locator('.type-pill-btn[data-type="annual_leave"]'),
        'the leave is still on record, so the row must still show it').toHaveAttribute('aria-pressed', 'true');
});

test('admin: the week grid writes NOTHING for a rest day answered free, and names the day (v23.88)', async ({ page }) => {
    // THE TWO SURFACES MEANT DIFFERENT THINGS BY ONE ANSWER (external review of v23.85). The AL card
    // wrote nothing for a rest day answered "Rest day — free"; the week grid wrote annual leave that
    // cost nothing — so the Calendar showed AL on a day the manager had just called a genuine rest
    // day, and `admin-al-projection.js` said "skipped" about a document that existed.
    //
    // The write is the assertion. `batchWrites` records every set() payload, so this can tell "no
    // document" from "a document that happens to cost nothing" — which the receipt text alone
    // cannot, and which is the entire difference the fix is about.
    await seedSession(page, 'G. Miller');
    // A SAVE THAT CANNOT WRITE WOULD PASS THE FIRST HALF FOR THE WRONG REASON. Without this the
    // fixture's auth has no current user, `executeSave` refuses with "you've been signed out", and
    // `batchWrites` is empty whatever the rule does. The control at the end is the proof it is not.
    await page.addInitScript(() => {
        /** @type {any} */ (window).__E2E = { ...(/** @type {any} */ (window).__E2E || {}), authUser: true };
    });
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });

    const target = await page.evaluate(async () => {
        const [rd, ou, cl] = await Promise.all([import('./roster-data.js'), import('./override-utils.js'), import('./christmas-leave.js')]);
        const rows = [...document.querySelectorAll('.day-row')].map(r => /** @type {any} */ (r).dataset.date);
        for (const m of rd.teamMembers) {
            if (m.hidden || m.managerOnly) continue;
            for (const d of rows) {
                if (!d) continue;
                const dt = new Date(d + 'T00:00:00');
                if (dt.getDay() === 0) continue;               // a Sunday is a different rule entirely
                if (cl.isChristmasClosureDate(d)) continue;   // never asked about — see the first swap test
                if (ou.isRestShift(rd.getBaseShift(m, dt))) return { name: m.name, date: d };
            }
        }
        return null;
    });
    expect(target, 'no member has a rest day in the displayed week').not.toBeNull();
    const t = /** @type {any} */ (target);

    await page.locator('#fieldMember').selectOption(t.name);
    await waitForReadsToLand(page, `${t.name}'s records never answered`);   // not a 400ms guess (test audit, 7 Nov 2026)
    const row = page.locator(`.day-row[data-date="${t.date}"]`);
    await expect(row).toHaveCount(1);

    // ── "Rest day — free": nothing is recorded, and the receipt says which day ──────────────────
    await clickInView(row.locator('.type-pill-btn[data-type="annual_leave"]'));
    await clickInView(row.locator('.al-swap-btn[data-swap="no"]'));
    await clickInView(page.locator('#saveBtn'));

    await expect(page.locator('.feedback, #weekGridFeedback').filter({ hasText: 'no leave recorded' }).first(),
        'a save that records nothing must still say what it did').toBeVisible();
    const afterFree = await page.evaluate(() => (/** @type {any} */ (window).__E2E?.batchWrites || []));
    expect(afterFree.filter((/** @type {any} */ w) => w.type === 'annual_leave' && w.date === t.date),
        'a rest day answered free must produce no annual leave document at all').toHaveLength(0);

    // …AND LEAVES NOTHING UNSAVED BEHIND (review A7). That branch never cleared the dirty flag, so
    // the next week arrow raised "unsaved changes" over a grid with nothing staged on it.
    await clickInView(page.locator('#nextWeekBtn'));
    await expect(page.locator('#unsavedBanner'), 'a clean grid must not claim unsaved changes').toBeHidden();
    await clickInView(page.locator('#prevWeekBtn'));
    await expect(row).toHaveCount(1);

    // ── THE CONTROL: the same row answered "Swapped — counts" IS written ────────────────────────
    // Without it the fix could be "the grid stopped writing annual leave", which is not the fix.
    await clickInView(row.locator('.type-pill-btn[data-type="annual_leave"]'));
    await clickInView(row.locator('.al-swap-btn[data-swap="yes"]'));
    await clickInView(page.locator('#saveBtn'));
    await expect(page.locator('#formFeedback'),   // by id — see the note in the test above
        'the control must actually save — otherwise the "no write" half above proves nothing')
        .toContainText(/saved for/);
    await expect.poll(async () => {
        const w = await page.evaluate(() => (/** @type {any} */ (window).__E2E?.batchWrites || []));
        return w.filter((/** @type {any} */ x) => x.type === 'annual_leave' && x.date === t.date).length;
    }, { message: 'a declared swap is real leave and must be written' }).toBe(1);
});

// ── "TODAY" AND "✓ SAVED" ON ONE DATE LINE (polish pass, owner report from a Galaxy) ─────────────
// A row that is both today and already saved carries two chips on its date line, and under Android
// text scaling that line wraps. As inline text the saved badge's vertical padding did not count
// towards its line, so the wrapped chip sat directly under "Today" — measured 0.17px apart at 390px
// and the owner's ~1.11× text, 1.09px at 412px / 1.3×. The date line is now a wrapping flex row with
// a row gap. Asserted as GEOMETRY because both chips are present and correct either way: nothing
// but their boxes can tell a clear gap from two chips touching.
test('admin: a row that is today AND saved keeps a clear gap between its two chips when they wrap', async ({ page }, testInfo) => {
    test.skip(!isTouchProject(testInfo), 'the stacked date line is the touch layout');
    await page.clock.setFixedTime(new Date('2026-07-15T09:00:00Z'));
    await page.setViewportSize({ width: 390, height: 900 });
    await seedSession(page, 'G. Miller');
    await page.addInitScript(() => {
        /** @type {any} */ (window).__E2E = { authUser: true,
            docs: [{ id: 't1', memberName: 'G. Miller', date: '2026-07-15', type: 'rdw', value: '14:45-23:55', note: '' }] };
    });
    await page.goto('/admin.html');
    await page.locator('#fieldMember').selectOption('G. Miller');
    const row = page.locator('.week-panel .day-row.today');
    await expect(row.locator('.overwrite-badge')).toBeVisible();
    await scaleText(page, 1.11);
    const g = await row.evaluate((r) => {
        const t = /** @type {Element} */ (r.querySelector('.day-today-tag')).getBoundingClientRect();
        const b = /** @type {Element} */ (r.querySelector('.overwrite-badge')).getBoundingClientRect();
        return { wrapped: b.top >= t.bottom - 1, gap: b.top - t.bottom };
    });
    expect(g.wrapped, 'the fixture must actually wrap the two chips, or the gap proves nothing').toBe(true);
    expect(g.gap, 'the wrapped saved chip must not touch the Today chip').toBeGreaterThanOrEqual(3);
});

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
    await expect(bar).toContainText('1 day over their 2026 AL entitlement');
});

// ── THE DESKTOP AUDIT (Nov 2026) ─────────────────────────────────────────────────────────────────
//
// Admin is the page most used at a desk, and the audit measured it at the station PC's sizes
// (1366×768, 1536×864, 1920×1080) rather than at the phone width every earlier pass started from. Each
// test below is GEOMETRY or a computed style read off the rendered page, because every one of these
// defects was invisible to a behavioural assertion: the DOM said the right thing while the pixels hid
// it, squashed it or put it 400px from where the reader was looking. Desktop-only where the subject is
// a mouse or a wide window; a phone's own layout is held by the tests above.

/** Admin at a desk-sized window on a fixed Wednesday (15 Jul 2026), as the audit shot it.
 *  @param {import('@playwright/test').Page} page @param {{ width: number, height: number }} size
 *  @param {any[]} [docs] */
async function deskAdmin(page, size, docs = []) {
    await page.clock.setFixedTime(new Date('2026-07-15T09:00:00Z'));
    await page.setViewportSize(size);
    await seedSession(page, 'G. Miller');
    await seedMember(page, 'G. Miller');   // the member on screen, or the grid opens on the roster's first name
    await page.addInitScript((d) => { const w = /** @type {any} */ (window); w.__E2E = Object.assign(w.__E2E || {}, { docs: d }); }, docs);
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
}

/** A token's resolved colour, serialised as the page serialises an outline that uses it.
 *  @param {import('@playwright/test').Page} page @param {string} name */
const tokenColour = (page, name) => page.evaluate((n) => {
    const el = document.createElement('i'); el.style.color = `var(${n})`; document.body.append(el);
    const c = getComputedStyle(el).color; el.remove(); return c;
}, name);

/** Wait until `loc` has no transition running — two frames first, so a change the last input has
 *  only just caused (a hover, a class) has had the chance to START. A read taken mid-transition, or
 *  before one begins, sees neither state, and a check that something did NOT change passes on it.
 *  @param {import('@playwright/test').Locator} loc */
async function settled(loc) {
    await loc.page().evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    await expect.poll(() => loc.evaluate(el => el.getAnimations().length), { message: 'its transitions finish' }).toBe(0);
    return loc;
}

test('admin: the side column SCROLLS to the Record button, rather than squashing its cards (1366×768)', async ({ page }, info) => {
    // A `.card` is `overflow: hidden`, so as a flex item its automatic minimum height is 0: the sticky
    // column shrank its cards to fit itself and never overflowed. With Record Annual Leave open the
    // Record button was cut off below a clipped card — 175px of it at this size — with nothing to
    // scroll, and the wheel moved nothing. `elementFromPoint` is the honest reading: a button can be
    // in the DOM, enabled and "visible", and still not be what a click there would hit.
    test.skip(isTouchProject(info), 'the sticky two-column layout and a mouse wheel');
    await deskAdmin(page, { width: 1366, height: 768 });
    await page.locator('#alToggleHeader').click();
    await expect(page.locator('#alRangePicker')).toBeVisible();
    const side = page.locator('.col-side');
    expect(await side.evaluate(el => el.scrollHeight - el.clientHeight),
        'the open card makes the column taller than the window, so it must overflow — not squash').toBeGreaterThan(50);
    const box = /** @type {{x:number,y:number,width:number,height:number}} */ (await side.boundingBox());
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 2000);
    await expect.poll(() => page.evaluate(() => {
        const b = /** @type {HTMLElement} */ (document.getElementById('alSaveBtn')).getBoundingClientRect();
        const s = /** @type {HTMLElement} */ (document.querySelector('.col-side')).getBoundingClientRect();
        const hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
        return { inColumn: b.top >= s.top - 1 && b.bottom <= s.bottom + 1, inWindow: b.bottom <= innerHeight, hit: hit?.id ?? '' };
    }), { message: 'after the wheel the Record button is in view, and is what a click there hits' })
        .toEqual({ inColumn: true, inWindow: true, hit: 'alSaveBtn' });
    // Every card keeps its own height: none is clipped by its own `overflow: hidden`.
    const clipped = await page.evaluate(() => [...document.querySelectorAll('.col-side > .card')]
        .filter(c => c.scrollHeight - c.clientHeight > 1).map(c => c.id));
    expect(clipped, 'a card in the side column is squashed below its content').toEqual([]);
});

test('admin: a save error is never under the Unsaved bar — scrolled to, or at the very end of the page (1366×768)', async ({ page }, info) => {
    // The bar is fixed over the foot of the screen and nothing reserved its height: the save error,
    // brought into view with block: 'nearest', stopped exactly behind it, and at the end of the page
    // there was nowhere further to scroll. The row turned red and the reason was hidden.
    test.skip(isTouchProject(info), 'a desk-sized window; the phone has the same reserve but its own layout');
    await deskAdmin(page, { width: 1366, height: 768 });
    const tue = page.locator('.day-row[data-date="2026-07-14"]');
    await tue.locator('label.col-day').click();
    await tue.locator('.pill-shift').click();
    await tue.locator('.day-start').fill('');
    await tue.locator('.day-end').fill('');
    await page.locator('#stagedSaveBtn').click();
    const feedback = page.locator('#formFeedback');
    await expect(feedback).toContainText('fill in the start and end time');
    const gap = () => page.evaluate(() => {
        const f = /** @type {HTMLElement} */ (document.getElementById('formFeedback')).getBoundingClientRect();
        const bar = /** @type {HTMLElement} */ (document.getElementById('stagedBar')).getBoundingClientRect();
        return Math.round(bar.top - f.bottom);
    });
    await expect.poll(gap, { message: 'the message, scrolled to, ends above the bar' }).toBeGreaterThanOrEqual(0);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect.poll(gap, { message: 'and at the end of the page it still clears the bar' }).toBeGreaterThanOrEqual(0);
});

// APPLY IS GREYED OUT UNTIL IT CAN ACT, AND SAYS WHY (owner, Nov 2026). The audit above left Apply live,
// refusing a press with something missing in a line under it; the owner chose Save changes' own pattern
// instead — greyed out until it can do something, the reason in the line beneath. A phone and a desk
// alike, so this runs on both projects. The Sunday refusal below is the one a press still finds.
test('admin: Apply is greyed out until a day is ticked AND a type is chosen, and the line under it says which is missing', async ({ page }, info) => {
    await deskAdmin(page, isTouchProject(info) ? { width: 393, height: 851 } : { width: 1366, height: 768 });
    const apply = page.locator('#bulkApplyBtn');
    const why = page.locator('#bulkApplyHint');
    const al = page.locator('#bulkTypePills .pill-annual_leave');
    // Nothing ticked, no type: greyed out the way Save changes is, which nothing is staged for either.
    await expect(apply).toBeDisabled();
    await expect(why).toHaveText('Tick at least one day and choose a type');
    await expect(page.locator('#saveBtn'), 'premise: Save changes is greyed out too').toBeDisabled();
    const look = (/** @type {string} */ sel) => page.locator(sel).evaluate(el => ({ opacity: getComputedStyle(el).opacity, cursor: getComputedStyle(el).cursor }));
    expect(await look('#bulkApplyBtn'), 'Save\'s own disabled look, not a new one').toEqual(await look('#saveBtn'));
    // A screen reader reads the reason straight after the button, as it does Save's.
    const tree = (await page.locator('#bulkBar').ariaSnapshot()).split('\n').map(l => l.trim());
    const at = tree.findIndex(l => l.startsWith('- button "3 Apply to ticked days" [disabled]'));
    expect(at, 'Apply is in the tree, unavailable').toBeGreaterThan(-1);
    expect(tree[at + 1], 'and the next thing read is why').toBe('- paragraph: Tick at least one day and choose a type');
    // The line sits under the button, at its left edge — not centred under the bar.
    const geo = await page.evaluate(() => {
        const a = /** @type {HTMLElement} */ (document.getElementById('bulkApplyBtn')).getBoundingClientRect();
        const h = /** @type {HTMLElement} */ (document.getElementById('bulkApplyHint'));
        const r = document.createRange(); r.selectNodeContents(h); const t = r.getBoundingClientRect();
        return { below: Math.round(t.top - a.bottom), left: Math.round(t.left - a.left) };
    });
    expect(geo.below, 'directly under Apply').toBeGreaterThanOrEqual(0);
    expect(geo.below, 'directly under Apply').toBeLessThan(16);
    expect(Math.abs(geo.left), 'starting where Apply starts').toBeLessThanOrEqual(1);

    // A type, nothing ticked.
    await clickInView(al);
    await expect(apply).toBeDisabled();
    await expect(why).toHaveText('Tick the days to apply it to');
    await clickInView(al);   // the same pill again puts the type back
    await expect(why).toHaveText('Tick at least one day and choose a type');
    // Days ticked, no type — one by its own box, then a whole run.
    await clickInView(page.locator('.day-row[data-date="2026-07-14"] .day-cb'));
    await expect(apply).toBeDisabled();
    await expect(why).toHaveText('Choose a type for the ticked day');
    await clickInView(page.locator('#bulkSelMonFri'));
    await expect(why).toHaveText('Choose a type for the ticked days');
    await expect(apply).toBeDisabled();
    // Both: it can act, and the line goes quiet, as Save's does when there is something to save.
    await clickInView(al);
    await expect(apply).toBeEnabled();
    await expect(apply).toContainText('Apply “Annual Leave” to ticked days');
    await expect(why).toHaveText('');
    // …and it really applies: the five weekdays take the leave, the weekend does not.
    await clickInView(apply);
    const staged = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.day-row')]
        .map(r => [/** @type {HTMLElement} */ (r).dataset.date, /** @type {HTMLElement} */ (r).dataset.type || ''])));
    expect(staged).toEqual({ '2026-07-12': '', '2026-07-13': 'annual_leave', '2026-07-14': 'annual_leave',
        '2026-07-15': 'annual_leave', '2026-07-16': 'annual_leave', '2026-07-17': 'annual_leave', '2026-07-18': '' });
    await expect(page.locator('#saveBtn')).toBeEnabled();
    await expect(apply, 'the days are still ticked and the type still chosen').toBeEnabled();
});

// A row's own pill can untick it — pressing the chosen type again takes the row back to nothing — and the
// bar follows. Its count was read only when a box or a bulk button changed, so it went on counting a day
// no longer ticked; with Apply's state read from the same count, that would leave Apply live over nothing.
test('admin: a day unticked by its own pill leaves the bulk bar\'s count, and Apply', async ({ page }, info) => {
    await deskAdmin(page, isTouchProject(info) ? { width: 393, height: 851 } : { width: 1366, height: 768 });
    const tue = page.locator('.day-row[data-date="2026-07-14"]');
    await clickInView(tue.locator('.day-cb'));
    await clickInView(page.locator('#bulkTypePills .pill-rdw'));
    await expect(page.locator('#bulkSelCount')).toHaveText('1 day selected');
    await expect(page.locator('#bulkApplyBtn'), 'premise: a ticked day and a type').toBeEnabled();
    await clickInView(tue.locator('.pill-annual_leave'));
    await clickInView(tue.locator('.pill-annual_leave'));   // pressed again: the row goes back to nothing
    await expect(tue.locator('.day-cb'), 'premise: the row\'s own pill unticked it').not.toBeChecked();
    await expect(page.locator('#bulkSelCount'), 'the count follows the row').toHaveText('');
    await expect(page.locator('#bulkApplyBtn'), 'and Apply has nothing to act on').toBeDisabled();
    await expect(page.locator('#bulkApplyHint')).toHaveText('Tick the days to apply it to');
});

test('admin: a Sunday a type cannot go on greys Apply out too — the reason under it, before any press — and a working day beside it brings Apply back', async ({ page }, info) => {
    // The last refusal only a press used to find (owner, 8 Nov 2026): AL, Absent and Shift skip a Sunday
    // (the Sunday rule's layer 2), so a week whose only ticked day is the Sunday had nothing to apply,
    // and Apply looked ready until it was pressed. It is known before the press, so it is said before
    // it, the way the rest of Apply's reasons are (admin-bulk-apply.js). Layer 2 itself is unchanged: a
    // Sunday ticked among working days is still skipped by the apply, and the receipt says so.
    test.skip(isTouchProject(info), 'a desk-sized window');
    await deskAdmin(page, { width: 1366, height: 768 });
    const apply = page.locator('#bulkApplyBtn');
    const hint = page.locator('#bulkApplyHint');
    const sunday = page.locator('.day-row[data-date="2026-07-12"]');
    const monday = page.locator('.day-row[data-date="2026-07-13"]');
    await sunday.locator('.day-cb').check();
    await page.locator('#bulkTypePills .pill-annual_leave').click();
    await expect(apply, 'only a Sunday ticked, and AL cannot go on one').toBeDisabled();
    await expect(hint).toHaveText('Sunday isn’t a contracted day — tick a working day');
    await page.locator('#bulkTypePills .pill-rdw').click();
    await expect(apply, 'RDW can: a worked Sunday is RDW').toBeEnabled();
    await expect(hint).toHaveText('');
    await page.locator('#bulkTypePills .pill-sick').click();
    await expect(apply, 'nor can Absent').toBeDisabled();
    await page.locator('#bulkTypePills .pill-annual_leave').click();
    await monday.locator('.day-cb').check();
    await expect(apply, 'a working day ticked beside it: there is something to apply').toBeEnabled();
    await expect(hint).toHaveText('');
    await apply.click();
    await expect(monday, 'the working day is staged').toHaveAttribute('data-type', 'annual_leave');
    await expect(sunday, 'layer 2: nothing was staged on the Sunday').not.toHaveAttribute('data-type', /./);
    await expect(page.locator('#formFeedback'), 'and the receipt says the Sunday was skipped').toContainText('Sunday skipped');
});

test('admin: every focus ring stands out from what is behind it — navy on the card, gold on the navy bar', async ({ page }, info) => {
    // Gold is ~1.5:1 on a light surface, under the 3:1 a focus indicator needs, and around the gold
    // Today button it vanished outright; the navy ring on the Unsaved bar's Save was navy on navy. A
    // ring is drawn only for a keyboard, so no screenshot sees it: this reads the outline each control
    // actually gets, against the token for the surface it is drawn on.
    test.skip(isTouchProject(info), 'a keyboard ring');
    await deskAdmin(page, { width: 1366, height: 900 });
    const navy = await tokenColour(page, '--primary-blue');
    const gold = await tokenColour(page, '--accent-gold');
    // Stage something with the mouse first, so the Unsaved bar is up — then switch to the keyboard,
    // because `:focus-visible` follows the last input the reader used.
    const tue = page.locator('.day-row[data-date="2026-07-14"]');
    await tue.locator('label.col-day').click();
    await tue.locator('.pill-annual_leave').click();
    await expect(page.locator('#stagedBar')).toBeVisible();
    // …and a bulk type, because Apply is greyed out — out of the Tab order — until it can act (owner,
    // Nov 2026), and a ring is drawn only on a control that can take focus.
    await page.locator('#bulkTypePills .pill-rdw').click();
    await expect(page.locator('#bulkApplyBtn')).toBeEnabled();
    // A real Tab, so the focused control matches :focus-visible. WebKit hands a SCRIPTED focus() the
    // previous element's focus-visible state, and the last focus came from a click.
    await page.locator('#navMenuBtn').focus();
    await page.keyboard.press('Tab');
    /** @param {string} sel */
    const ring = async (sel) => {
        const loc = page.locator(sel);
        await loc.focus();
        return loc.evaluate(el => ({ visible: el.matches(':focus-visible'), style: getComputedStyle(el).outlineStyle, colour: getComputedStyle(el).outlineColor }));
    };
    for (const sel of ['#prevWeekBtn', '#nextWeekBtn', '#thisWeekBtn', '#bulkApplyBtn']) {
        expect(await ring(sel), `${sel} sits on the light card: its ring is navy`).toEqual({ visible: true, style: 'solid', colour: navy });
    }
    for (const sel of ['#stagedDiscardBtn', '#stagedSaveBtn']) {
        expect(await ring(sel), `${sel} sits on the navy bar: its ring is gold`).toEqual({ visible: true, style: 'solid', colour: gold });
    }
    // The week picker's month arrows are on its white panel (shared.css).
    await page.locator('#weekNavLabel').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.dp-content')).toBeVisible();
    for (const sel of ['#dpPrev', '#dpNext']) {
        expect(await ring(sel), `${sel} sits on the picker's white panel: its ring is navy`).toEqual({ visible: true, style: 'solid', colour: navy });
    }
});

test('admin: on a wide screen the Unsaved bar and the unsaved-changes banner keep their buttons over the page', async ({ page }, info) => {
    // At 1920 the bar's buttons sat at x=1701–1904 and the banner's the same — ~400px right of the
    // 1100px page, at the window's edge. The bar itself still spans the window; its CONTENT keeps to
    // the band, as the AL over-limit bar's already did.
    test.skip(isTouchProject(info), 'a wide window');
    await deskAdmin(page, { width: 1920, height: 1080 });
    const tue = page.locator('.day-row[data-date="2026-07-14"]');
    await tue.locator('label.col-day').click();
    await tue.locator('.pill-annual_leave').click();
    await expect(page.locator('#stagedBar')).toBeVisible();
    /** @param {string} sel */
    const within = (sel) => page.evaluate((s) => {
        const c = /** @type {HTMLElement} */ (document.querySelector('main.container')).getBoundingClientRect();
        const r = /** @type {HTMLElement} */ (document.querySelector(s)).getBoundingClientRect();
        return { left: Math.round(r.left - c.left), right: Math.round(c.right - r.right) };
    }, sel);
    for (const sel of ['.staged-bar-label', '.staged-bar-btns']) {
        const m = await within(sel);
        expect(m.left, `${sel} starts inside the page`).toBeGreaterThanOrEqual(0);
        expect(m.right, `${sel} ends inside the page`).toBeGreaterThanOrEqual(0);
    }
    // The banner: a week change with that staged edit asks first.
    await page.locator('#prevWeekBtn').click();
    await expect(page.locator('#unsavedBanner')).toBeVisible();
    const banner = await within('.unsaved-banner-btns');
    expect(banner.right, 'the banner\'s buttons end inside the page').toBeGreaterThanOrEqual(0);
    expect(banner.left, 'the banner\'s buttons start inside the page').toBeGreaterThanOrEqual(0);
});

test('admin: the unsaved-changes banner closes on Escape and keeps the edit; the Unsaved bar is the last Tab stop, not the first', async ({ page }, info) => {
    test.skip(isTouchProject(info), 'a keyboard');
    await deskAdmin(page, { width: 1366, height: 768 });
    const week = await page.locator('#weekNavLabel').textContent();
    const tue = page.locator('.day-row[data-date="2026-07-14"]');
    await tue.locator('label.col-day').click();
    await tue.locator('.pill-annual_leave').click();
    await expect(page.locator('#stagedBar')).toBeVisible();
    // Escape answers the question the way "Keep editing" does: nothing moves, nothing is discarded.
    await page.locator('#prevWeekBtn').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#unsavedBanner')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#unsavedBanner')).toBeHidden();
    await expect(page.locator('#weekNavLabel'), 'the week did not change').toHaveText(/** @type {string} */ (week));
    await expect(tue, 'the staged AL is still staged').toHaveAttribute('data-type', 'annual_leave');
    await expect(page.locator('#prevWeekBtn'), 'focus is back where the reader was').toBeFocused();
    // The bar is drawn at the foot of the screen, and it comes AFTER the page in the tab order: before
    // <main>, its two buttons were the first Tab stops whenever anything was staged.
    await page.locator('#navMenuBtn').focus();
    await page.keyboard.press('Shift+Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('#stagedBar')),
        'nothing before the burger — the Unsaved bar is not ahead of the page').toBe(false);
    expect(await page.evaluate(() => !!(document.querySelector('main')?.compareDocumentPosition(
        /** @type {HTMLElement} */ (document.getElementById('stagedBar'))) & Node.DOCUMENT_POSITION_FOLLOWING)),
        'the bar follows <main> in the document').toBe(true);
});

test('admin: on a desktop the staff member picker is two Tab presses from the burger, as on a phone — and still sits atop the right column', async ({ page }, info) => {
    // From 1024px the bar used to be MOVED into the right column, which put the page's one member
    // control behind the whole Change a Shift card: 23 Tab presses, against 2 on a phone. It now keeps
    // its place in the document and is only DRAWN in the right column — the same place as before, and
    // the side column stuck the same 16px beneath it while the page scrolls.
    test.skip(isTouchProject(info), 'the two-column layout and a keyboard');
    await deskAdmin(page, { width: 1366, height: 768 });
    await page.locator('#navMenuBtn').focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(page.locator('#fieldMemberTrigger'), 'burger → logo → the member picker').toBeFocused();
    const geo = () => page.evaluate(() => {
        const bar = /** @type {HTMLElement} */ (document.querySelector('.member-context-bar')).getBoundingClientRect();
        const side = /** @type {HTMLElement} */ (document.querySelector('.col-side')).getBoundingClientRect();
        const main = /** @type {HTMLElement} */ (document.querySelector('.col-main')).getBoundingClientRect();
        return { sameColumn: Math.abs(bar.left - side.left) < 1 && Math.abs(bar.width - side.width) < 1,
                 rightOfMain: bar.left > main.right, gap: Math.round(side.top - bar.bottom), top: Math.round(bar.top) };
    });
    const atRest = await geo();
    expect(atRest.sameColumn && atRest.rightOfMain, 'the bar is drawn atop the right column').toBe(true);
    expect(atRest.gap, 'with the side column 16px beneath it').toBe(16);
    await page.evaluate(() => window.scrollTo(0, 300));
    await expect.poll(geo, { message: 'scrolled, the two stay pinned together: the bar at the top, the column under it' })
        .toEqual({ sameColumn: true, rightOfMain: true, gap: 16, top: 20 });
});

// THE STAFF PICKER SHOWS KEYBOARD FOCUS ON THE NAVY BAR (Nov 2026). Below 1024px the member bar is navy,
// and the picker took a field's default ring — navy, drawn 2px out on the navy bar, 1:1 — so only its
// border turning gold said where focus was. It wears the gold ring the navy Unsaved bar's buttons wear;
// from 1024px the bar is a white card and keeps the navy one. Measured from the PAINTED colours: what
// counts is the ring against what is actually behind it, which no token comparison can see.
test('admin: the staff picker\'s focus ring stands out from the member bar behind it — navy on a phone, white at a desk', async ({ page }, info) => {
    const sizes = isTouchProject(info) ? [{ width: 393, height: 851 }] : [{ width: 900, height: 800 }, { width: 1366, height: 768 }];
    await deskAdmin(page, sizes[0]);
    for (const size of sizes) {
        await page.setViewportSize(size);
        await page.locator('#navMenuBtn').focus();
        await page.keyboard.press('Tab');
        await page.keyboard.press('Tab');
        const picker = page.locator('#fieldMemberTrigger');
        await expect(picker, `${size.width}: burger → logo → the member picker`).toBeFocused();
        const m = await picker.evaluate(el => {
            // Any CSS colour as painted, over what is under it: a canvas resolves oklch, color-mix and alpha
            // (the recipe of calendar.spec.js → installColourProbe, which one spec cannot import from another).
            const ctx = /** @type {CanvasRenderingContext2D} */ (document.createElement('canvas').getContext('2d', { willReadFrequently: true }));
            const paint = (/** @type {string[]} */ ...layers) => { ctx.clearRect(0, 0, 1, 1);
                layers.forEach(c => { ctx.fillStyle = c; ctx.fillRect(0, 0, 1, 1); }); return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3); };
            const lum = (/** @type {number[]} */ c) => c.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; })
                .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
            let host = el.parentElement;   // the surface the ring is drawn on: the nearest painted ancestor
            while (host && getComputedStyle(host).backgroundColor === 'rgba(0, 0, 0, 0)') host = host.parentElement;
            const behind = getComputedStyle(/** @type {Element} */ (host)).backgroundColor, cs = getComputedStyle(el);
            const [hi, lo] = [lum(paint(behind, cs.outlineColor)), lum(paint(behind))].sort((a, b) => b - a);
            const reach = parseFloat(cs.outlineOffset) + parseFloat(cs.outlineWidth), r = el.getBoundingClientRect(), b = /** @type {Element} */ (host).getBoundingClientRect();
            return { focusVisible: el.matches(':focus-visible'), style: cs.outlineStyle, width: parseFloat(cs.outlineWidth),
                     ratio: Math.round((hi + 0.05) / (lo + 0.05) * 100) / 100, onBar: /** @type {Element} */ (host).classList.contains('member-context-bar'),
                     ringInsideBar: r.left - reach >= b.left && r.right + reach <= b.right && r.top - reach >= b.top && r.bottom + reach <= b.bottom };
        });
        expect(m.focusVisible, `${size.width}: a keyboard focus`).toBe(true);
        expect(m.onBar, `${size.width}: premise: the ring is drawn on the member bar`).toBe(true);
        expect(m.style, `${size.width}: a ring is drawn`).not.toBe('none');
        expect(m.width, `${size.width}: at least 2px`).toBeGreaterThanOrEqual(2);
        expect(m.ratio, `${size.width}: 3:1 against the bar behind it`).toBeGreaterThanOrEqual(3);
        expect(m.ringInsideBar, `${size.width}: and the bar has room for all of it`).toBe(true);
    }
});

test('admin: each calendar is ONE Tab stop, and the arrow keys move the day — the leave range and the week jump', async ({ page }, info) => {
    // Every day was its own Tab stop: ~62 to cross the two open range calendars, and the arrows did
    // nothing in either picker. Now a roving tabindex, as the Calendar's own grid.
    test.skip(isTouchProject(info), 'a keyboard');
    await deskAdmin(page, { width: 1366, height: 900 });
    await page.locator('#alToggleHeader').click();
    const grid = page.locator('#alRpGrid');
    const stops = grid.locator('.rp-day[tabindex="0"]');
    await expect(stops, 'one stop in the whole month').toHaveCount(1);
    await expect(stops, 'and it is today, with nothing chosen yet').toHaveAttribute('data-iso', '2026-07-15');
    await stops.focus();
    const at = () => page.evaluate(() => /** @type {HTMLElement|null} */ (document.activeElement)?.dataset.iso ?? null);
    await page.keyboard.press('ArrowRight');
    expect(await at()).toBe('2026-07-16');
    await page.keyboard.press('ArrowDown');
    expect(await at()).toBe('2026-07-23');
    await page.keyboard.press('End');
    expect(await at(), 'End is the week row\'s Saturday').toBe('2026-07-25');
    await page.keyboard.press('PageDown');
    expect(await at(), 'Page Down turns the month').toBe('2026-08-25');
    await expect(page.locator('#alRpLabel')).toHaveText('August 2026');
    await expect(stops, 'the stop moved with the keyboard, and is still the only one').toHaveCount(1);
    await expect(stops).toHaveAttribute('data-iso', '2026-08-25');
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('#alRpGrid')), 'one Tab leaves the month').toBe(false);

    // The week jump: the app's own date picker, opened from the keyboard.
    await page.locator('#weekNavLabel').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.dp-content')).toBeVisible();
    await expect(page.locator('#dpGrid .dp-day:not([tabindex="-1"])'), 'one stop in the picker\'s month').toHaveCount(1);
    expect(await at(), 'it opens on the chosen day').toBe('2026-07-15');
    await page.keyboard.press('ArrowRight');
    expect(await at()).toBe('2026-07-16');
    await page.keyboard.press('ArrowUp');
    expect(await at()).toBe('2026-07-09');
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('#dpGrid')), 'one Tab leaves the picker\'s month').toBe(false);
});

test('admin: with a mouse, the bulk bar\'s type pills are the same capsules as a row\'s', async ({ page }, info) => {
    // They kept the base 44px height for a fine pointer — AL a 36×44 lozenge, taller than wide — beside
    // the 46×34 capsules on every row. A touch screen keeps its own, larger, sizes.
    test.skip(isTouchProject(info), 'a fine pointer');
    await deskAdmin(page, { width: 1366, height: 900 });
    await page.locator('.day-row[data-date="2026-07-14"] label.col-day').click();
    const size = (/** @type {string} */ sel) => page.locator(sel).evaluate(el => {
        const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) };
    });
    const bulk = await size('#bulkTypePills .pill-annual_leave');
    const row = await size('.day-row[data-date="2026-07-14"] .pill-annual_leave');
    expect(bulk.h, 'the bulk pill is the row pill\'s height').toBe(row.h);
    expect(bulk.w, 'and wider than it is tall').toBeGreaterThan(bulk.h);
});

test('admin: hovering a chosen type pill leaves it as it is; an idle one takes a tint of its colour, never a fade', async ({ page }, info) => {
    // `opacity: 0.75` on every pill under the pointer faded a CHOSEN AL's white-on-teal from 5.19:1 to
    // 3.31:1 — a hover repainting a choice, and a fade on words still being read.
    test.skip(isTouchProject(info), 'a mouse');
    await deskAdmin(page, { width: 1366, height: 900 });
    const tue = page.locator('.day-row[data-date="2026-07-14"]');
    await tue.locator('label.col-day').click();
    const chosen = tue.locator('.pill-annual_leave');
    await chosen.click();
    await expect(chosen).toHaveClass(/\bactive\b/);
    // Read once the pill's transition has run: "did not change" passes trivially on a read taken
    // before the hover's own transition has begun.
    const paint = async (/** @type {import('@playwright/test').Locator} */ loc) => (await settled(loc))
        .evaluate(el => ({ op: getComputedStyle(el).opacity, bg: getComputedStyle(el).backgroundColor }));
    await page.mouse.move(2, 2);
    expect(await paint(chosen), 'premise: the chosen pill at rest is AL\'s own fill')
        .toEqual({ op: '1', bg: await tokenColour(page, '--al') });
    await chosen.hover();
    expect(await paint(chosen), 'the chosen pill does not change under the pointer')
        .toEqual({ op: '1', bg: await tokenColour(page, '--al') });
    const idle = tue.locator('.pill-rdw');
    await idle.hover();
    const hovered = await paint(idle);
    expect(hovered.op, 'an idle pill is never faded').toBe('1');
    expect(hovered.bg, 'it takes a tint instead').not.toBe('rgba(0, 0, 0, 0)');
});

test('admin: ticking or typing a row never moves it, a row ready to save is not Today\'s colour, and Tips describes what is drawn', async ({ page }, info) => {
    // Ticking widened the left border 1px → 4px and shoved the row's content 3px right; a row with a
    // type wore `--today-print`, Today's own tint, with no bar; and Tips said the row "turns gold".
    test.skip(isTouchProject(info), 'the desk layout and a mouse');
    await deskAdmin(page, { width: 1366, height: 900 });
    const row = (/** @type {string} */ iso) => page.locator(`.day-row[data-date="${iso}"]`);
    // Each read waits for the row's transitions (its tint and bar ease in), or two states compare
    // as different only because one was caught halfway.
    const look = async (/** @type {string} */ iso) => (await settled(row(iso))).evaluate(el => ({
        cb: Math.round(/** @type {HTMLElement} */ (el.querySelector('.day-cb')).getBoundingClientRect().left * 10) / 10,
        bg: getComputedStyle(el).backgroundColor, bar: getComputedStyle(el).boxShadow,
    }));
    const untouched = await look('2026-07-13');
    await row('2026-07-13').locator('.day-cb').check();
    const ticked = await look('2026-07-13');
    await row('2026-07-13').locator('.pill-annual_leave').click();
    await page.mouse.move(2, 2);
    const ready = await look('2026-07-13');
    expect(ticked.cb, 'ticking does not move the row').toBe(untouched.cb);
    expect(ready.cb, 'nor does giving it a type').toBe(untouched.cb);
    const today = await look('2026-07-15');
    expect(ready.bg, 'a row ready to save is not Today\'s tint').not.toBe(today.bg);
    expect(ready.bg, 'nor the ticked row\'s').not.toBe(ticked.bg);
    expect(ticked.bar, 'a ticked row has its bar').toMatch(/inset/);
    expect(ready.bar, 'so does a row ready to save').toMatch(/inset/);
    expect(ready.bar, 'the bar is drawn').not.toMatch(/^rgba\(0, 0, 0, 0\)|^none/);
    // A mouse is told the rest of the row is a target too — on an untouched row only.
    const sat = row('2026-07-18');
    const restBg = (await look('2026-07-18')).bg;
    await sat.hover({ position: { x: 300, y: 10 } });
    expect((await look('2026-07-18')).bg, 'an untouched row tints under the pointer').not.toBe(restBg);
    // Tips: the words match the pixels.
    await page.locator('.btn-card-tips[data-card="change-shift"]').click();
    const tips = page.locator('#tipsLbBody');
    await expect(tips).toContainText('with a gold edge, to show it is ready to save');
    await expect(tips).toContainText('A ticked day with no type yet has the gold edge only');
    await expect(tips, 'the arrows, for a mouse — not swipe alone').toContainText('Move between weeks with ‹ and ›');
});

test('admin: the small things on a desk — Today\'s word, the Saved Changes times, and no "tap" in the save hint', async ({ page }, info) => {
    test.skip(isTouchProject(info), 'the desk layout');
    await deskAdmin(page, { width: 1366, height: 900 }, [
        { id: 'c1', memberName: 'G. Miller', date: '2026-07-17', value: '06:00-14:00', type: 'shift', source: 'manual' },
    ]);
    // "Today" was 10px — the smallest word on the page, inside an 84×44 gold button.
    expect(parseFloat(await page.locator('.week-today-word').evaluate(el => getComputedStyle(el).fontSize)),
        'the Today word is a readable size').toBeGreaterThanOrEqual(12);
    // The save hint names no touch verb on a desk.
    await expect(page.locator('#saveBtnHint')).not.toContainText(/\btap\b/i);
    // Saved Changes' times were a system monospace — Consolas on the station PC.
    await page.locator('#overridesToggleHeader').click();
    const value = page.locator('.override-card .oc-value').first();
    await expect(value).toContainText('06:00');
    const fonts = await value.evaluate(el => ({ own: getComputedStyle(el).fontFamily, page: getComputedStyle(document.body).fontFamily, nums: getComputedStyle(el).fontVariantNumeric }));
    expect(fonts.own, 'the times are in the page\'s typeface').toBe(fonts.page);
    expect(fonts.nums, 'with tabular figures, so they line up').toBe('tabular-nums');
});
