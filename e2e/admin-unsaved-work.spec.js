/**
 * admin-unsaved-work.spec.js — Admin (admin.html): staged work — signing out or leaving with unsaved
 * edits, the draft kept when the page goes, and the week read again on return.
 *
 * Split by feature out of admin.spec.js on 25 Nov 2026, test for test and unchanged; what more than
 * one admin-*.spec.js file needs is in admin-helpers.js. admin.spec.js had itself been split out of
 * pages.spec.js on 3 Nov 2026; the tests that span pages, and the shared drawer, dialogs and sheets,
 * stay there.
 */
import { test, expect } from './fixtures.js';
import { seedSessionOnce, clickInView, seedMemberSession, waitForReadsToLand } from './helpers.js';
import { openAdminOnDecember, openAdminOnThisWeek } from './admin-helpers.js';

// Admin signed out BEFORE asking about unsaved week-grid edits (v24.52, page-session.js): the drawer
// released the session and the push record, and only the reload that followed met `beforeunload` —
// which a phone suppresses, so the edits went without a word. It now asks first, like Link Designer.
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
    await expect(dialog).toContainText('If you sign out now they will be lost.');
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

// ── LEAVING ADMIN BY THE DRAWER OR THE LOGO ASKS FIRST (whole-app review, Oct 2026) ────────────
// Only the browser's own unload prompt guarded those exits, and a phone never shows it, so staged
// rows were discarded without a word. The drawer asks in a dialog (the page's banner would sit under
// the drawer's scrim); the logo goes through the same banner as every other exit on the page.

// THE KEYBOARD IS NOT LEFT ON <body> WHEN A BAR GOES FROM UNDER IT (review, 21 Nov 2026). The sticky
// bar's Save and the unsaved banner's "Discard changes" both hid the very button that was pressed.
test('admin: after the sticky bar\'s Save, and after the banner\'s "Discard changes", focus is somewhere real', async ({ page }) => {
    await openAdminOnDecember(page);
    await page.evaluate(() => { /** @type {any} */ (window).__E2E.authUser = true; });
    const absent = () => page.locator('.day-row').filter({ has: page.locator('.type-pill-btn[data-type="sick"]:not([disabled])') }).first();
    await clickInView(absent().locator('.type-pill-btn[data-type="sick"]'));
    await page.locator('#stagedSaveBtn').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#formFeedback')).toContainText('✓');
    await expect(page.locator('#formFeedback'), 'the receipt, once the bar has gone').toBeFocused();

    await clickInView(absent().locator('.type-pill-btn[data-type="sick"]'));
    await page.locator('#nextWeekBtn').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#unsavedBanner')).toBeVisible();
    // Another week is a move WITHIN the page: the member leaves nothing, so it is not the leave question
    // (review, 22 Nov 2026) — and "Keep editing" is still the safe answer, with the focus.
    await expect(page.getByRole('alertdialog', { name: 'Discard your unsaved changes?' })).toBeVisible();
    await expect(page.locator('#unsavedBannerMsg')).toHaveText('Discard your unsaved changes? They will be lost if you move on now.');
    await expect(page.locator('#unsavedDiscardBtn')).toHaveText('Discard changes');
    await expect(page.locator('#unsavedKeepBtn')).toHaveText('Keep editing');
    await expect(page.locator('#unsavedKeepBtn')).toBeFocused();
    await page.locator('#unsavedDiscardBtn').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#unsavedBanner')).toBeHidden();
    await expect(page.locator('#nextWeekBtn'), 'back to the arrow that asked to leave').toBeFocused();
});

// THE DIALOG OVER THE DRAWER OWNS THE KEYBOARD (v25.06, whole-app review). The drawer's own keydown
// handler had no topmost check, so with "Leave without saving?" open over it, Tab dragged focus into
// the drawer behind the modal and a single Escape closed BOTH — two surfaces, two history steps.
test('admin: with the leave question open over the drawer, Tab stays in it and Escape closes only it', async ({ page }) => {
    await openAdminOnDecember(page);
    const row = page.locator('.day-row').filter({ has: page.locator('.type-pill-btn[data-type="shift"]:not([disabled])') }).first();
    await clickInView(row.locator('.type-pill-btn[data-type="shift"]'));
    await row.locator('.day-start').fill('06:00');
    await row.locator('.day-end').fill('14:00');
    await page.locator('#navMenuBtn').click();
    await page.locator('.nav-panel-pill--calendar').click();
    await expect(page.getByText('Your unsaved changes on this page will be lost.', { exact: true })).toBeVisible();
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
    await expect(page.getByText('Your unsaved changes on this page will be lost.', { exact: true })).toBeHidden();
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
    await expect(page.getByText('Your unsaved changes on this page will be lost.', { exact: true })).toBeVisible();
    // …then the new dialog's own entry, which is what a Back is meant to close.
    await expect.poll(overlayEntry, { message: 'the dialog holds the top history entry' }).toBe(true);
    await page.evaluate(() => history.back());
    await expect(page.getByText('Your unsaved changes on this page will be lost.', { exact: true })).toBeHidden();
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
    await expect(page.getByText('Your unsaved changes on this page will be lost.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Keep editing' }).click();
    await expect(page, 'Cancel must keep the page').toHaveURL(/admin\.html/);
    await expect(row.locator('.day-start')).toHaveValue('06:00');

    // The logo: the drawer's own question (it leaves the page too), and "Keep editing" keeps it.
    await page.keyboard.press('Escape');
    await page.locator('#appIcon').click();
    await expect(page.getByRole('alertdialog', { name: 'Leave without saving?' }).filter({ hasText: 'Your unsaved changes on this page will be lost.' })).toBeVisible();
    await page.getByRole('button', { name: 'Keep editing' }).click();
    await expect(page).toHaveURL(/admin\.html/);
    await expect(row.locator('.day-start')).toHaveValue('06:00');

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
    await page.getByRole('button', { name: 'Leave without saving', exact: true }).click({ noWaitAfter: true });
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
// "Calendar" and "Staff & Admin Guide" sit in the About panel (#iconLightbox), outside the
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
    await page.locator('#bugReportLink').evaluate((el) => el.addEventListener('click', (e) => {
        e.preventDefault(); /** @type {any} */ (window).__bugTapped = true;
    }));
    await page.locator('#bugReportLink').click();
    expect(await page.evaluate(() => /** @type {any} */ (window).__bugTapped), 'the tap reached the link').toBe(true);
    await expect(page.locator('.dialog-overlay'), 'mail leaves the page where it is').toHaveCount(0);

    // Calendar: asked, and Cancel keeps the page and the edit.
    const question = page.getByText('Your unsaved changes on this page will be lost.', { exact: true });
    await about.getByRole('link', { name: 'Calendar', exact: true }).click();
    await expect(question).toBeVisible();
    await page.getByRole('button', { name: 'Keep editing' }).click();
    await expect(question).toBeHidden();
    await expect(page, 'Cancel must keep the page').toHaveURL(/admin\.html/);
    await expect(row.locator('.day-start')).toHaveValue('06:00');

    // Leave goes — stopped at the network and read from the request, as the drawer test above does.
    const leaving = page.waitForRequest((req) => req.isNavigationRequest() && !req.url().includes('admin.html'));
    await page.route((url) => url.pathname === '/', (route) => route.fulfill({ status: 204 }));
    await about.getByRole('link', { name: 'Calendar', exact: true }).click();
    await page.getByRole('button', { name: 'Leave without saving', exact: true }).click({ noWaitAfter: true });
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

// A NOTIFICATION'S "RELOAD" RELOADS, AND IS THE ONE QUESTION (confirm review, Nov 2026). A tap whose page is
// this one, at the hash it is already on, was "reloaded" by assigning the same address, which is a
// same-document hop that reloads nothing; and page-session was never told the question was answered, so the
// browser's "Leave site?" asked again on a desktop, and a draft was kept of the work the member had chosen
// to leave. The worker's half (asking, then sending "open later") is sw-notification-tap.test.mjs.
test('admin: a notification\'s Reload over staged edits really reloads, asks nothing more, and keeps no draft', async ({ page }) => {
    await openAdminOnDecember(page);
    const row = page.locator('.day-row').filter({ has: page.locator('.type-pill-btn[data-type="shift"]:not([disabled])') }).first();
    await clickInView(row.locator('.type-pill-btn[data-type="shift"]'));
    await row.locator('.day-start').fill('06:00');
    await row.locator('.day-end').fill('14:00');
    /** @type {string[]} */ const browserAsked = [];
    page.on('dialog', d => { browserAsked.push(d.type()); d.dismiss().catch(() => {}); });   // a "Stay" would stop the reload
    await page.evaluate(() => {
        /** @type {any} */ (window).__beforeReload = true;
        history.replaceState(history.state, '', '#tapped');   // the tap's address, hash and all, is the page's own
        navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: { type: 'myb-open-later', url: location.href } }));
    });
    const dialog = page.getByRole('alertdialog', { name: 'Open the notification?' });
    await expect(dialog).toContainText('If you open the notification now, they may be lost.');
    await dialog.getByRole('button', { name: 'Reload', exact: true }).click();
    await expect.poll(() => page.evaluate(() => /** @type {any} */ (window).__beforeReload === true).catch(() => true),
        { message: 'the page did not reload' }).toBe(false);
    await page.waitForSelector('.day-row', { timeout: 10000 });
    expect(browserAsked, 'the browser asked a second time').toEqual([]);
    expect(await page.evaluate((k) => localStorage.getItem(k), ADMIN_DRAFT), 'a draft was kept of the work the member left').toBeNull();
});

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
    expect(kept?.data?.rows).toEqual([expect.objectContaining({ date, type: 'sick', was: null })]);   // drawn from no record
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

// A KEPT ROW REMEMBERS THE WHOLE RECORD IT WAS EDITED OVER (external review, 14 Nov 2026). The draft kept
// only id|type|value, so a colleague's fresh save of the same value — a note, a new revision — read as
// unchanged, and Restore put the old edit back over it with no "changed since". The save after a Restore
// cannot catch it: it compares with what the restored row now shows, which is the colleague's record.
for (const [label, colleagueSavedSince] of /** @type {[string, boolean][]} */ ([
    ['the same record', false],
    ['a record a colleague has saved again since, with a note', true],
])) {
    test(`admin: a kept edit over a saved day, Restored over ${label}, ${colleagueSavedSince ? 'is left as saved and named' : 'is put back'}`, async ({ page }) => {
        const shown = { id: 'm_2026-12-08_G.%20Miller', memberName: 'G. Miller', date: '2026-12-08', type: 'annual_leave', value: 'AL',
            note: '', source: 'manual', changedBy: 'G. Miller', createdAt: 1_000 };
        await page.addInitScript((doc) => { /** @type {any} */ (window).__E2E = Object.assign(/** @type {any} */ (window).__E2E || {}, { docs: [doc] }); }, shown);
        await openAdminOnDecember(page);
        const row = page.locator('.day-row[data-date="2026-12-08"]');
        await expect(row.locator('.type-pill-btn[data-type="annual_leave"]'), 'premise: the row is drawn from its record').toHaveAttribute('aria-pressed', 'true');
        await clickInView(row.locator('.type-pill-btn[data-type="sick"]'));
        await expect(page.locator('#saveBtn')).toBeEnabled();
        await setVisibility(page, 'hidden');
        const kept = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), ADMIN_DRAFT);
        expect(kept?.data?.rows?.[0]?.was, 'the whole record the row was drawn from is kept')
            .toMatchObject({ id: shown.id, type: 'annual_leave', value: 'AL', note: '', changedBy: 'G. Miller', createdAt: 1_000 });
        if (colleagueSavedSince) {
            // What the next load reads: the same AL, the same value, saved again by a manager with a note.
            await page.addInitScript((doc) => { /** @type {any} */ (window).__E2E.docs = [doc]; },
                { ...shown, note: 'swap agreed with a colleague', changedBy: 'S. Manager', createdAt: 2_000 });
        }
        await reloadPastLeaveSite(page);
        const offer = page.locator('.dialog-overlay.visible');
        await expect(offer).toContainText('Restore your unsaved changes from');
        await offer.getByRole('button', { name: 'Restore' }).click();
        await expect(page.locator('#weekNavLabel')).toContainText('Dec 2026');
        const sick = page.locator('.day-row[data-date="2026-12-08"] .type-pill-btn[data-type="sick"]');
        if (colleagueSavedSince) {
            await expect(page.locator('#formFeedback')).toContainText(/Your unsaved changes were not put back: .*8 Dec.* has changed since\./);
            await expect(sick, "the old edit was put over the colleague's record").toHaveAttribute('aria-pressed', 'false');
            await expect(page.locator('#saveBtn'), 'nothing staged').toBeDisabled();
        } else {
            await expect(page.locator('#formFeedback')).toContainText('Your unsaved changes are back — check them, then select Save changes.');
            await expect(sick).toHaveAttribute('aria-pressed', 'true');
            await expect(page.locator('#saveBtn')).toBeEnabled();
        }
    });
}

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

// WORK A SAVE HAS SINCE LANDED IS NOT UNSAVED (unsaved-draft.js, rule 6; v25.97). Found on the real SDK:
// the page went while its save was still waiting, the save landed, and the next load asked "Restore your
// unsaved changes?" about it — then Restore named the day as changed since, about the member's own save.
// The draft now carries what the save was SENDING, and the next load judges the outcome: a day that holds
// it landed. A save that never landed — held only in memory, or a transaction the page abandoned — is
// still work, and is offered as before.
/** Stage an absence, start its save and hold it unanswered, then hide the page: the draft a phone keeps
 *  when the app is put away mid-save. @param {import('@playwright/test').Page} page */
async function stageAbsenceSaveHeldAndHide(page) {
    await openAdminOnDecember(page);
    const row = page.locator('.day-row').filter({ has: page.locator('.type-pill-btn[data-type="sick"]:not([disabled])') }).first();
    const date = /** @type {string} */ (await row.getAttribute('data-date'));
    await clickInView(row.locator('.type-pill-btn[data-type="sick"]'));
    await page.evaluate(() => { /** @type {any} */ (window).__E2E.holdCommits = true; });
    await clickInView(page.locator('#saveBtn'));
    await expect.poll(() => page.evaluate(() => (/** @type {any} */ (window).__E2E._held || []).length),
        { message: 'the save never reached its commit' }).toBeGreaterThan(0);
    await setVisibility(page, 'hidden');
    const kept = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), ADMIN_DRAFT);
    expect(kept?.data?.rows, 'hidden mid-save: the staged row is kept').toEqual([expect.objectContaining({ date, type: 'sick' })]);
    expect(kept?.data?.sending, 'with what its save was sending').toEqual([{ member: 'G. Miller', date, type: 'sick', value: 'SICK' }]);
    return { date };
}

test('admin: a save still waiting when the page went, and landed since, is not offered back as unsaved', async ({ page }) => {
    const { date } = await stageAbsenceSaveHeldAndHide(page);
    await page.addInitScript((d) => {   // the next load: the save has landed
        const w = /** @type {any} */ (window);
        w.__E2E = { ...(w.__E2E || {}), docs: [{ id: `m_${d}_G.%20Miller`, memberName: 'G. Miller', date: d, type: 'sick', value: 'SICK',
            note: '', source: 'manual', changedBy: 'G. Miller' }] };
    }, date);
    await reloadPastLeaveSite(page);
    await page.waitForSelector('.day-row', { timeout: 10000 });
    await waitForReadsToLand(page);
    await expect.poll(() => page.evaluate((k) => localStorage.getItem(k), ADMIN_DRAFT),
        { message: 'the landed save was still kept as unsaved work' }).toBeNull();
    await expect(page.locator('.dialog-overlay'), 'asked "Restore your unsaved changes?" about a change that was saved').toHaveCount(0);
});

test('admin: a save still waiting when the page went that never landed is offered back, and Restore puts it back', async ({ page }) => {
    const { date } = await stageAbsenceSaveHeldAndHide(page);
    await reloadPastLeaveSite(page);   // nothing landed: a save held only in memory, or a transaction the page abandoned
    const offer = page.locator('.dialog-overlay.visible');
    await expect(offer).toContainText('Restore your unsaved changes from');
    await offer.getByRole('button', { name: 'Restore' }).click();
    await expect(page.locator(`.day-row[data-date="${date}"] .type-pill-btn[data-type="sick"]`)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#formFeedback')).toContainText('Your unsaved changes are back');
});

// A DISMISSAL IS NOT AN ANSWER (shared-ui-2). The question arrives a moment after the page, once the
// member's records are in, so a tap meant for the grid lands on the backdrop — most of a phone screen.
// That, Escape and Android Back each used to count as Discard and delete the kept rows for good.
test('admin: a tap outside the offer, Escape or Back answers nothing — the kept rows are asked about again', async ({ page }) => {
    const { clock } = await stageAbsenceAndHide(page);
    await reloadPastLeaveSite(page);
    const offer = page.locator('.dialog-overlay.visible');
    for (const [how, dismiss] of /** @type {Array<[string, () => Promise<unknown>]>} */ ([
        ['a tap on the backdrop', () => offer.click({ position: { x: 4, y: 4 } })],
        ['Escape', () => page.keyboard.press('Escape')],
        ['Android Back', () => page.evaluate(() => history.back())],
    ])) {
        await expect(offer, `asked again before ${how}`).toContainText(`Restore your unsaved changes from ${clock}?`);
        await dismiss();
        await expect(page.locator('.dialog-overlay'), `${how} closes the question`).toHaveCount(0);
        expect(await page.evaluate((k) => localStorage.getItem(k), ADMIN_DRAFT), `${how} is not Discard`).not.toBeNull();
        await expect(page.locator('#saveBtn'), 'and puts nothing back').toBeDisabled();
        await page.reload();
    }
    await expect(offer, 'still waiting for an answer').toContainText(`Restore your unsaved changes from ${clock}?`);
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

// RESTORE PUTS ROWS BACK ONLY ON THEIR OWN MEMBER AND WEEK (whole-app check, Nov 2026). The offer waits for the
// draft's member to be read, and meanwhile the member on screen can be edited. Restore then jumped — which,
// with this week's own changes staged, stops at "Discard or keep editing?" — and put the rows back anyway, onto
// the member on screen, under "Your unsaved changes are back". A Save would have written them to that person.
test('admin: Restore while another member\'s same week holds changes of its own puts nothing on it, and keeps the draft', async ({ page }) => {
    const { date } = await stageAbsenceAndHide(page);   // G. Miller, week of 7 Dec 2026
    await page.addInitScript(() => {   // after the session seeder's own, which selects the signed-in member
        localStorage.setItem('myb_roster_selected_member', 'S. Silva');
        window.__E2E = { ...(window.__E2E || {}), docsDelayMs: 1500 };
    });
    const accept = (/** @type {import('@playwright/test').Dialog} */ d) => d.accept().catch(() => {});
    page.on('dialog', accept);
    await page.goto('/admin.html?date=2026-12-07');   // S. Silva's same week, as a link from the Calendar opens it
    page.off('dialog', accept);
    // S. Silva's read is slow; G. Miller's — the one the offer waits for — is held until this test has edited S. Silva.
    const memberReads = () => page.evaluate(() => ((/** @type {any} */ (window).__E2E.whereCalls || [])).filter((/** @type {any[]} */ w) => w[0] === 'memberName').map((/** @type {any[]} */ w) => w[2]));
    await expect.poll(memberReads).toEqual(['S. Silva']);
    await page.evaluate(() => { const e = /** @type {any} */ (window).__E2E; e.docsHeld = true; e.docsDelayMs = 0; });
    await page.waitForSelector('.day-row', { timeout: 10000 });
    await expect(page.locator('#fieldMember')).toHaveValue('S. Silva');
    await expect.poll(memberReads, { message: 'premise: the offer\'s read of G. Miller is out, and held' }).toEqual(['S. Silva', 'G. Miller']);
    await expect(page.locator('.dialog-overlay.visible')).toHaveCount(0);
    const own = page.locator(`.day-row:not([data-date="${date}"])`)
        .filter({ has: page.locator('.type-pill-btn[data-type="annual_leave"]:not([disabled])') }).last();
    await own.locator('.day-cb').click();
    await clickInView(own.locator('.type-pill-btn[data-type="annual_leave"]'));
    const ownDate = await own.getAttribute('data-date');
    expect(ownDate, 'premise: S. Silva\'s own change is on another day').not.toBe(date);

    await page.evaluate(() => { /** @type {any} */ (window).__E2E.docsHeld = false; });
    const offer = page.locator('.dialog-overlay.visible');
    await expect(offer).toContainText('Restore your unsaved changes');
    await offer.getByRole('button', { name: 'Restore' }).click();
    await expect(page.locator('#formFeedback')).toContainText('Your unsaved changes weren’t put back, because this week has changes of its own.');
    await expect(page.locator('#fieldMember')).toHaveValue('S. Silva');
    await expect(page.locator(`.day-row[data-date="${date}"] .type-pill-btn[data-type="sick"]`), 'G. Miller\'s absence is not on S. Silva').toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator(`.day-row[data-date="${ownDate}"] .type-pill-btn[data-type="annual_leave"]`), 'S. Silva\'s own change stands').toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate((k) => localStorage.getItem(k), ADMIN_DRAFT), 'kept, for the next load').not.toBeNull();
});

// A SAVE THAT LANDS FORGETS THE COPY THE HIDE KEPT (whole-app check, Nov 2026). Saving and then switching
// app is what the slow save teaches, so the rows are kept while the commit waits. When it landed, every
// row was switched off before the week was redrawn — and a switched-off row with a saved record reads
// as a staged removal, so on any week holding one the "saved: forget it" check found unsaved work and
// kept the copy. A page iOS then discarded offered to restore work that had been saved.
test('admin: a save landing while the page is hidden forgets the kept copy, on a week holding another saved change', async ({ page }) => {
    await page.addInitScript(() => {
        const w = /** @type {any} */ (window);
        w.__E2E = { ...(w.__E2E || {}), holdCommits: true, docs: [{ id: 'm_2026-12-09_G.%20Miller', memberName: 'G. Miller',
            date: '2026-12-09', type: 'annual_leave', value: 'AL', note: '', source: 'manual' }] };
    });
    await openAdminOnDecember(page);
    await expect(page.locator('.day-row[data-date="2026-12-09"] .overwrite-badge'), 'premise: Wednesday holds a saved change, untouched').toContainText('Saved');
    await page.locator('.day-row[data-date="2026-12-08"] .day-cb').click();
    await page.locator('.day-row[data-date="2026-12-08"] .type-pill-btn[data-type="annual_leave"]').click();
    await page.locator('#saveBtn').click();
    await expect(page.locator('#saveBtn')).toContainText('Saving');
    await setVisibility(page, 'hidden');
    expect(await page.evaluate((k) => localStorage.getItem(k), ADMIN_DRAFT), 'premise: hidden mid-save, the rows are kept').not.toBeNull();

    await page.evaluate(() => /** @type {any} */ (window).__E2E.releaseCommits());
    await expect(page.locator('#formFeedback')).toContainText('1 change saved for G. Miller', { timeout: 10000 });
    expect(await page.evaluate((k) => localStorage.getItem(k), ADMIN_DRAFT), 'saved: forgotten as it lands, not at a later hide').toBeNull();
});

// …AND WHILE A READ THAT WAS ALREADY RUNNING FINISHES, THE WEEK READS AS SAVED. A save waits for a read in
// flight at commit (All staff, a Retry, the return refresh) before it redraws, and in that wait the rows
// were switched off and nothing recounted: the day just saved showed nothing, a saved day lost its type,
// and under "1 change saved" the Unsaved bar still read "1 day".
test('admin: while a read that was running at the save finishes, the week reads as saved, not as unsaved', async ({ page }) => {
    await page.addInitScript(() => {
        const w = /** @type {any} */ (window);
        w.__E2E = { ...(w.__E2E || {}), docs: [{ id: 'm_2026-12-09_G.%20Miller', memberName: 'G. Miller',
            date: '2026-12-09', type: 'annual_leave', value: 'AL', note: '', source: 'manual' }] };
    });
    await openAdminOnDecember(page);
    const badge = (/** @type {string} */ d) => page.locator(`.day-row[data-date="${d}"] .overwrite-badge`);
    await expect(badge('2026-12-09'), 'premise: Wednesday holds a saved change, untouched').toContainText('Saved');
    await page.locator('#overridesToggleHeader').click();
    await page.evaluate(() => { /** @type {any} */ (window).__E2E.docsHeld = true; });
    await page.locator('#showAllOverridesBtn').click();   // the collection read, held in flight
    await page.locator('.day-row[data-date="2026-12-08"] .day-cb').click();
    await page.locator('.day-row[data-date="2026-12-08"] .type-pill-btn[data-type="annual_leave"]').click();
    await page.locator('#saveBtn').click();
    await expect(page.locator('#formFeedback')).toContainText('1 change saved for G. Miller', { timeout: 10000 });

    // Committed, and waiting on the read.
    const al = (/** @type {string} */ d) => page.locator(`.day-row[data-date="${d}"] .type-pill-btn[data-type="annual_leave"]`);
    await expect(badge('2026-12-08'), 'the day just saved reads as saved').toContainText('Saved');
    await expect(al('2026-12-08')).toHaveAttribute('aria-pressed', 'true');
    await expect(al('2026-12-09'), 'a saved day nobody touched keeps its type').toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#stagedBar'), 'nothing reads as unsaved').toBeHidden();
    await expect(page.locator('#gridPreview')).toBeHidden();

    await page.evaluate(() => { /** @type {any} */ (window).__E2E.docsHeld = false; });
    await waitForReadsToLand(page, 'the All staff read never landed');
    await expect(badge('2026-12-08')).toContainText('Saved');
    await expect(page.locator('#saveBtn'), 'and the save has finished').toHaveText('Save changes');
});

// ── A WEEK LEFT OPEN IS READ AGAIN WHEN THE APP COMES BACK (iPhone audit, Nov 2026) ─────────────
// An installed app is not reloaded when it is reopened — iOS keeps it resident for days — and Admin
// read its week once, with "Today" stamped as it drew. Back after five minutes away, with nothing
// staged and nothing sending, the week is read and drawn again; a glance at another app is not.
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
