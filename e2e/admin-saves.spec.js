/**
 * admin-saves.spec.js — Admin (admin.html): saving — the receipt, a slow or revoked save, the first
 * read, a colleague's change refused, and the page's own write.
 *
 * Split by feature out of admin.spec.js on 25 Nov 2026, test for test and unchanged; what more than
 * one admin-*.spec.js file needs is in admin-helpers.js. admin.spec.js had itself been split out of
 * pages.spec.js on 3 Nov 2026; the tests that span pages, and the shared drawer, dialogs and sheets,
 * stay there.
 */
import { test, expect } from './fixtures.js';
import { seedSession, clickInView, seedMemberSession, waitForReadsToLand, pastDoubleTap } from './helpers.js';
import { isRestShift } from '../override-utils.js';
import { getBaseShift, CONFIG, teamMembers } from '../roster-data.js';
import { fmtPeriodDate } from '../admin-period-dates.js';
import {
    inventedCea, serveInventedMember, openAdminOnDecember, openAdminOnThisWeek, LEAVE_LIST_DAY,
} from './admin-helpers.js';

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

// THE CONSEQUENCE BESIDE SAVE, AND THE SAME WORDS AFTER IT (owner, 27 Nov 2026): a staged day says what it
// is now and what it becomes, and the receipt repeats it.
test('admin: a staged day says before → after beside Save, and the receipt says the same', async ({ page }) => {
    await page.addInitScript(() => { window.__E2E = { ...(window.__E2E || {}), authUser: true }; });
    await seedSession(page, 'G. Miller');
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    await page.locator('#fieldDate').evaluate((el) => {
        /** @type {HTMLInputElement} */ (el).value = '2027-01-11';       // Monday, a worked day (the test above)
        el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect(page.locator('#weekNavLabel')).toContainText('Jan 2027');
    const name = await page.locator('#fieldMember').inputValue();
    const base = getBaseShift(/** @type {any} */ (teamMembers.find(m => m.name === name)), new Date(2027, 0, 11));
    expect(base, 'premise: Monday is a worked shift').toMatch(/^\d{2}:\d{2}-\d{2}:\d{2}$/);
    const words = `${base.replace('-', '–')} → Annual leave`;

    const monday = page.locator('.day-row[data-date="2027-01-11"]');
    await monday.locator('.day-cb').click();                          // a day's type buttons show once it is ticked
    await monday.locator('.type-pill-btn[data-type="annual_leave"]').click();
    const preview = page.locator('#gridPreview');
    await expect(preview).toContainText('You\'re about to change 1 day');
    await expect(preview.locator('.grid-preview-days li')).toHaveText(new RegExp(`11 Jan.*: ${words.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));

    await page.locator('#saveBtn').click();
    const feedback = page.locator('#formFeedback');
    await expect(feedback).toContainText('1 change saved for', { timeout: 10000 });
    const receipt = feedback.locator('.save-receipt');
    await receipt.locator('summary').click();
    await expect(receipt.locator('li')).toHaveText(new RegExp(`11 Jan.* — ${words.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
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
    // …and since v25.90 an online save is a CHECKED transaction, which no device holds: it asks the reader
    // to keep the page open, and never says the change is held and will send by itself.
    await expect(notice).toContainText('Keep this page open');
    await expect(notice).not.toContainText('held on this device');
    await expect(notice, 'an unconfirmed write must never be called saved').not.toContainText(/saved/i);
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
    // online is written to the admin's Error Log, so a phone whose every save is slow says so — and it
    // says how much of the wait the page spent in the background (v25.87): this one never left the
    // screen, so the wait was the server's, the reading an iPhone report could not give. And it says how
    // the checked save's check of this device's own earlier saves went (22 Nov 2026): nothing of its own
    // queued here, so online it asked its records and did not wait at all (27 Nov 2026) — three iPhone
    // reports of exactly 8.1s could not say whether it had.
    await expect.poll(() => page.evaluate(() => (/** @type {any} */ (window).__E2E.setWrites || [])
        .filter((/** @type {any} */ w) => /^Slow save \(diagnostic\)/.test(w.data?.message ?? ''))
        .map((/** @type {any} */ w) => w.data.message)), { timeout: 5000 })
        .toEqual([expect.stringMatching(/took \d+\.\ds to be confirmed — a save while the phone said it was online · on screen throughout · sign-in token \d+\.\ds · own-saves wait 0\.\ds, skipped, its records clear · installed app: /)]);
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
    // OFFLINE, the save is still the batch the device holds (v25.90): the check needs the server, so here
    // it is skipped and the change sends by itself when the signal returns, as every save did before.
    await expect(notice).toContainText('held on this device');
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

// ── A CHANGE MADE WHILE A SAVE IS SENDING IS REFUSED, NOT TAKEN AND THROWN AWAY (Nov 2026) ─────────
// The batch is the grid as it stood at the press. When the commit lands every row is reset and the week
// redrawn, so a tap in the wait — seconds on an iPhone (KNOWN_LIMITATIONS) — used to light up, then
// vanish under a receipt that never mentioned it: Monday re-typed as Absent still SAVED as leave.
// Clicked with the real mouse, so a held grid is met the way a finger meets it.
test('admin: a change tapped while a save is still sending is refused, not taken and then thrown away', async ({ page }) => {
    await page.addInitScript(() => { window.__E2E = { ...(window.__E2E || {}), authUser: true, holdCommits: true }; });
    await seedSession(page, 'G. Miller');
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    await page.locator('#fieldMember').selectOption('G. Miller');
    await page.locator('#fieldDate').evaluate((el) => {
        /** @type {HTMLInputElement} */ (el).value = '2027-01-11';
        el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect(page.locator('#weekNavLabel')).toContainText('Jan 2027');
    // Monday and Tuesday are both rostered working days on this line, so leave asks nothing. A row's
    // pills show once it is ticked, so each is ticked first, as a person does.
    const box  = (/** @type {string} */ d) => page.locator(`.day-row[data-date="${d}"] .day-cb`);
    const pill = (/** @type {string} */ d, /** @type {string} */ t) =>
        page.locator(`.day-row[data-date="${d}"] .type-pill-btn[data-type="${t}"]`);
    await box('2027-01-11').click();
    await pill('2027-01-11', 'annual_leave').click();
    await page.locator('#saveBtn').click();
    await expect(page.locator('#saveBtn')).toContainText('Saving');

    // While the commit waits: Monday re-typed as Absent, Tuesday ticked, and the bulk bar's All 7.
    // A finger taps what it can SEE. `force` is a click at the target's centre without Playwright's
    // "receives events" check — it has to be, because a held week receives none — and WebKit scrolls a
    // target to the nearest EDGE, which at phone width is under the sticky member bar: there the tap
    // opened the member sheet (mobile-safari, CI run 42838201900), and "nor by the bulk bar" passed
    // only because the bulk bar was never reached. So each tap is centred first, and the point it will
    // land on is checked to be the week's own card.
    const tapHeld = async (/** @type {import('@playwright/test').Locator} */ target) => {
        await target.evaluate((el) => el.scrollIntoView({ block: 'center' }));
        expect(await target.evaluate((el) => {
            const r = el.getBoundingClientRect();
            const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            return !!hit && !!document.getElementById('change-shift')?.contains(hit);
        }), 'premise: the tap lands on the held week, not on whatever sits over it').toBe(true);
        await target.click({ force: true });
    };
    await tapHeld(pill('2027-01-11', 'sick'));
    await tapHeld(box('2027-01-12'));
    await tapHeld(page.locator('#bulkSelAll'));
    await expect(pill('2027-01-11', 'annual_leave'), 'the row being saved keeps the type it is being saved as').toHaveAttribute('aria-pressed', 'true');
    await expect(pill('2027-01-11', 'sick')).toHaveAttribute('aria-pressed', 'false');
    await expect(box('2027-01-12'), 'nothing new is staged while the save is sending').not.toBeChecked();
    await expect(box('2027-01-15'), 'nor by the bulk bar').not.toBeChecked();

    await page.evaluate(() => /** @type {any} */ (window).__E2E.releaseCommits());
    await expect(page.locator('#formFeedback')).toContainText('1 change saved for G. Miller', { timeout: 10000 });
    const written = await page.evaluate(() => /** @type {any} */ (window).__E2E.batchWrites.map((/** @type {any} */ w) => `${w.date} ${w.type}`));
    expect(written, 'the save wrote the batch it was pressed with').toEqual(['2027-01-11 annual_leave']);
    await expect(pill('2027-01-11', 'annual_leave'), 'and the week shows what was saved').toHaveAttribute('aria-pressed', 'true');
    // …and the week is editable again once it has landed.
    await box('2027-01-12').click();
    await pill('2027-01-12', 'annual_leave').click();
    await expect(pill('2027-01-12', 'annual_leave')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#saveBtn')).toBeEnabled();
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
    const before = await page.evaluate(() => (/** @type {any} */ (window).__E2E.batchWrites || []).length);
    await page.locator('#saveBtn').click();
    await expect(page.locator('#formFeedback')).toContainText('Reload the page before making another', { timeout: 5000 });
    expect(await page.evaluate(() => (/** @type {any} */ (window).__E2E.batchWrites || []).length), 'no second copy was written').toBe(before);
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

// THE FIRST READ WAITS FOR THE SESSION (whole-app check, Nov 2026). On an iPhone Firebase can restore no
// user behind a valid local session (AUTH_AND_SESSIONS.md), and Admin then signs in silently. The boot
// read went out first — with no credential, which the overrides rule refuses — and nothing retried it once
// the sign-in landed: "Couldn't load" on a page whose session was fine. Held here: a sign-in that never lands.
test('admin: the first read of saved changes waits for the silent sign-in, and the week says it is loading', async ({ page }) => {
    await page.addInitScript(() => { window.__E2E = { ...(window.__E2E || {}), hangSignIn: true }; });
    await seedSession(page, 'G. Miller');
    await page.goto('/admin.html');
    await page.waitForFunction(() => document.body.classList.contains('auth-ready'));
    await expect.poll(() => page.evaluate(() => (/** @type {any} */ (window).__E2E.signIns || []).length),
        { message: 'premise: the silent sign-in is out' }).toBeGreaterThan(0);
    await expect(page.locator('#weekGrid')).toContainText("Loading this member's saved changes");
    expect(await page.evaluate(() => /** @type {any} */ (window).__E2E.docReads || 0), 'no read before the session is there').toBe(0);
});

// …AND WHILE THAT FIRST READ IS OUT, THE WEEK SAYS SO. It showed the page's static "Select a staff member
// and date above to load the week" — over a member bar and a week label already showing both.
test('admin: while the first read is out, the week says it is loading, not "select a staff member"', async ({ page }) => {
    await page.addInitScript(() => { window.__E2E = { ...(window.__E2E || {}), authUser: true, docsHeld: true }; });
    await seedSession(page, 'G. Miller');
    await page.goto('/admin.html');
    await expect.poll(() => page.evaluate(() => /** @type {any} */ (window).__E2E.docReads || 0), { message: 'premise: the read is out' }).toBeGreaterThan(0);
    await expect(page.locator('#weekGrid')).toContainText("Loading this member's saved changes");
    await expect(page.locator('#weekGrid')).not.toContainText('Select a staff member');
    await page.evaluate(() => { /** @type {any} */ (window).__E2E.docsHeld = false; });
    await page.waitForSelector('.day-row', { timeout: 10000 });
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

// A STALE DELETE IS REFUSED (Oct 2026 production review). Admin's cache never refreshes on its own,
// and a manual record has one id per member and day, so deleting what this page showed hours ago
// removed what a colleague had written since. The page compares what it deletes with what the server
// holds, in the same transaction as the delete (v25.89); here the server answers that the day now
// holds a different record.
// THE ROW AS IT WAS DRAWN (v25.89, independent review). A removal staged in the week grid is compared with
// the record its row SHOWED. A read landing meanwhile — "All staff" here — refreshes the cache under staged
// edits and deliberately leaves the grid alone; compared with the cache, a colleague's newer record matched
// the server and was deleted under a row that still showed the old one.
test('admin: clearing a day a colleague has since changed is refused, even after a read brought the change into the page', async ({ page }) => {
    const id = 'm_2026-12-09_G.%20Miller';
    await page.addInitScript((docId) => {
        const w = /** @type {any} */ (window);
        w.__E2E = { ...(w.__E2E || {}), docs: [{ id: docId, memberName: 'G. Miller', date: '2026-12-09', type: 'annual_leave', value: 'AL', note: '', source: 'manual' }] };
    }, id);
    await openAdminOnDecember(page);
    const row = page.locator('.week-panel .day-row[data-date="2026-12-09"]');
    await expect(row.locator('.overwrite-badge')).toContainText('Saved');
    await row.locator('.type-pill-btn[data-type="annual_leave"]').click();   // stage its removal
    await expect(row.locator('.overwrite-badge')).toContainText('Removing');
    // A colleague makes the day a worked rest day: the server holds it, and the next read brings it into the page.
    await page.evaluate((docId) => {
        const theirs = { id: docId, memberName: 'G. Miller', date: '2026-12-09', type: 'rdw', value: '14:00-22:00', note: '', source: 'manual', changedBy: 'S. Manager' };
        const w = /** @type {any} */ (window);
        w.__E2E.docs = [theirs];
        w.__E2E.txDocs = [theirs];
    }, id);
    await page.locator('#overridesToggleHeader').click();
    await page.locator('#showAllOverridesBtn').click();
    await waitForReadsToLand(page, 'the All staff read never landed');
    await expect(row.locator('.overwrite-badge'), 'premise: the staged removal of the AL is still on screen').toContainText('Removing');
    await page.locator('#saveBtn').click();
    await expect(page.locator('#formFeedback')).toContainText('so nothing was saved', { timeout: 10000 });
    expect(await page.evaluate(() => (window.__E2E?.deletedPaths || []).length), "the colleague's RDW was deleted").toBe(0);
});

// THE SECOND EDITOR OF A DAY IS TOLD (v25.90). A plain save was a batch, so of two managers saving one day
// the later simply won and nobody said so. It now reads each day it writes in the same transaction as the
// write: here the day showed nothing, a colleague has saved it since, and the save is refused — the day
// named, nothing written — instead of overwriting their change.
test('admin: saving a day a colleague has saved since the page loaded is refused, and names the day', async ({ page }) => {
    await openAdminOnDecember(page);
    const row = page.locator('.week-panel .day-row[data-date="2026-12-08"]');
    await row.locator('.day-cb').click();
    await row.locator('.type-pill-btn[data-type="annual_leave"]').click();
    // A colleague saves the same day meanwhile: the server holds it now, and this page never loaded it.
    await page.evaluate(() => {
        /** @type {any} */ (window).__E2E.txDocs = [{ id: 'm_2026-12-08_G.%20Miller', memberName: 'G. Miller', date: '2026-12-08',
            type: 'rdw', value: '14:00-22:00', note: '', source: 'manual', changedBy: 'S. Manager' }];
    });
    await page.locator('#saveBtn').click();
    await expect(page.locator('#formFeedback')).toContainText(
        'Someone else has changed Tue 8 Dec since the page loaded, so nothing was saved. Reload the page to see the latest, then try again.',
        { timeout: 10000 });
    expect(await page.evaluate(() => (/** @type {any} */ (window).__E2E.batchWrites || []).length), "the colleague's day was overwritten").toBe(0);
    await expect(row.locator('.type-pill-btn[data-type="annual_leave"]'), 'the staged change stays, to re-apply after a reload').toHaveAttribute('aria-pressed', 'true');
});

// …COMPARED WITH THE ROW AS IT WAS DRAWN (v25.90), as a removal has been since v25.89: a read landing under
// staged edits refreshes the cache and leaves the grid alone, so the cache can hold a colleague's newer
// record for a day whose row still shows the old one. Compared with the cache, it would match the server.
test('admin: re-typing a day a colleague has changed is refused, even after a read brought the change into the page', async ({ page }) => {
    const id = 'm_2026-12-09_G.%20Miller';
    await page.addInitScript((docId) => {
        const w = /** @type {any} */ (window);
        w.__E2E = { ...(w.__E2E || {}), docs: [{ id: docId, memberName: 'G. Miller', date: '2026-12-09', type: 'annual_leave', value: 'AL', note: '', source: 'manual' }] };
    }, id);
    await openAdminOnDecember(page);
    const row = page.locator('.week-panel .day-row[data-date="2026-12-09"]');
    await expect(row.locator('.overwrite-badge')).toContainText('Saved');
    await row.locator('.type-pill-btn[data-type="sick"]').click();   // re-type the AL as an absence
    await page.evaluate((docId) => {
        const theirs = { id: docId, memberName: 'G. Miller', date: '2026-12-09', type: 'rdw', value: '14:00-22:00', note: '', source: 'manual', changedBy: 'S. Manager' };
        const w = /** @type {any} */ (window);
        w.__E2E.docs = [theirs];
        w.__E2E.txDocs = [theirs];
    }, id);
    await page.locator('#overridesToggleHeader').click();
    await page.locator('#showAllOverridesBtn').click();
    await waitForReadsToLand(page, 'the All staff read never landed');
    await page.locator('#saveBtn').click();
    await expect(page.locator('#formFeedback')).toContainText('Someone else has changed Wed 9 Dec since the page loaded, so nothing was saved.', { timeout: 10000 });
    expect(await page.evaluate(() => (/** @type {any} */ (window).__E2E.batchWrites || []).length), "the colleague's RDW was overwritten").toBe(0);
});

// …AND SO IS A LEAVE OR ABSENCE RANGE (v25.90): each day of the booking is read in the same transaction
// as the write, so an absence recorded over a day a colleague has since booked leave on is refused.
test('admin: an absence over a day a colleague has changed since is refused, names the day, and writes nothing', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-08-27T09:00:00Z'));
    await seedMemberSession(page, 'G. Miller');
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    await page.locator('#fieldMember').selectOption('G. Miller');
    await page.locator('#sickToggleHeader').click();
    await page.locator('#sickRpNext').click();
    const day = page.locator('#sickRpGrid .rp-day[data-iso="2026-09-08"]');   // Tue 8 Sep, a working day on his line
    await day.click();
    await day.click();
    await expect(page.locator('#sickSaveBtn')).toBeEnabled();
    await page.evaluate(() => {
        /** @type {any} */ (window).__E2E.txDocs = [{ id: 'm_2026-09-08_G.%20Miller', memberName: 'G. Miller', date: '2026-09-08',
            type: 'annual_leave', value: 'AL', note: '', source: 'manual', changedBy: 'S. Manager' }];
    });
    await clickInView(page.locator('#sickSaveBtn'));
    await expect(page.locator('#sickFeedback')).toContainText(
        'Someone else has changed Tue 8 Sep since the page loaded, so nothing was saved.', { timeout: 10000 });
    expect(await page.evaluate(() => (/** @type {any} */ (window).__E2E.batchWrites || []).length), "the colleague's leave was overwritten").toBe(0);
});

test('admin: a booked period a colleague has since changed is not deleted, and the admin is told', async ({ page }) => {
    await page.clock.setFixedTime(LEAVE_LIST_DAY);   // the list must open on 2026, where the booking is
    await seedMemberSession(page, 'G. Miller');
    await page.addInitScript(() => {
        /** @type {any} */ (window).__E2E = Object.assign(/** @type {any} */ (window).__E2E || {}, {
            docs: [{ id: 'a1', memberName: 'G. Miller', date: '2026-03-02', type: 'annual_leave', value: 'AL', note: '' }],
            // What the server holds NOW, which is what a transaction reads: another manager has made the
            // day a worked rest day.
            txDocs: [{ id: 'a1', memberName: 'G. Miller', date: '2026-03-02', type: 'rdw', value: '09:00-17:00' }],
        });
    });
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    await page.locator('#fieldMember').selectOption('G. Miller');
    await page.locator('#alToggleHeader').click();
    await page.locator('#alBookedToggle').click();
    const btn = page.locator('#alBookedBody .btn-period-delete').first();
    await btn.click();
    await pastDoubleTap(page);
    await btn.click();
    await expect(page.locator('#alFeedback')).toContainText(/Someone else has changed this/);
    expect(await page.evaluate(() => (window.__E2E?.deletedPaths || []).length), 'something was deleted').toBe(0);
    await expect(page.locator('#alBookedBody .btn-period-delete')).toHaveCount(1);
});

// ── THE PAGE'S OWN WRITE IS NOT A COLLEAGUE'S (Nov 2026, review) ──────────────────────────────────────
// A delete in Saved Changes, a leave or absence range, a Recorded dates delete and a leave-year move each
// leave the week grid alone while a change is staged in it, so as not to throw that change away. The week
// save compares each day with what its ROW showed, so the grid went on comparing with the record the page
// itself had just deleted or replaced: the next Save refused the admin's own work as "Someone else has
// changed …", and its advice — reload — threw every staged change away. The rows of the days such a write
// touched now follow it, and only those (admin-own-write.js): a staged change on one of them is cleared and
// named, never saved over the day as it now stands, and every other row keeps the record it was drawn from,
// which is what keeps a colleague's change refused.
const OWN_MON = 'm_2026-08-24_G.%20Miller', OWN_FRI = 'm_2026-08-28_G.%20Miller';
/** Monday 24 Aug's annual leave on record, and the week of Thu 27 Aug open on it.
 *  @param {import('@playwright/test').Page} page @param {any[]} [more] further saved records */
async function openWeekWithMondayLeave(page, more = []) {
    await page.addInitScript((rows) => {
        const w = /** @type {any} */ (window);
        w.__E2E = { ...(w.__E2E || {}), docs: rows };
    }, [{ id: OWN_MON, memberName: 'G. Miller', date: '2026-08-24', type: 'annual_leave', value: 'AL', note: '', source: 'manual' }, ...more]);
    await openAdminOnThisWeek(page);
}
/** @param {import('@playwright/test').Page} page @param {string} date */
const weekRow = (page, date) => page.locator(`.week-panel .day-row[data-date="${date}"]`);
/** Every day this page has written, as "date type", in order. @param {import('@playwright/test').Page} page */
const writtenDays = (page) => page.evaluate(() => (/** @type {any} */ (window).__E2E.batchWrites || [])
    .map((/** @type {any} */ w) => `${w.date} ${w.type}`));
/** The two-tap ✕ of one Saved Changes row, the card already open. @param {import('@playwright/test').Page} page @param {string} id */
async function deleteSavedChange(page, id) {
    const del = page.locator(`#overrideTableBody .btn-delete[data-id="${id}"]`);
    await clickInView(del);
    await expect(del).toHaveText('Delete?');
    await pastDoubleTap(page);
    await clickInView(del);
}
/** Book Annual Leave for Mon 24 – Tue 25 Aug on the leave card, and keep editing the week. @param {import('@playwright/test').Page} page */
async function bookMondayTuesdayLeave(page) {
    await page.locator('#alToggleHeader').click();
    await page.locator('#alRpGrid .rp-day[data-iso="2026-08-24"]').click();
    await page.locator('#alRpGrid .rp-day[data-iso="2026-08-25"]').click();
    await clickInView(page.locator('#alSaveBtn'));
    await expect(page.locator('#alFeedback')).toContainText('Recorded 2 days of Annual Leave', { timeout: 10000 });
    // The card then shows the booked week in Change a Shift, which asks first while changes are staged.
    await expect(page.locator('#unsavedBanner')).toBeVisible();
    await page.locator('#unsavedKeepBtn').click();
}

test('admin: deleting a saved change for another day of the week keeps the staged edit, and the week then saves', async ({ page }) => {
    await openWeekWithMondayLeave(page);
    const monday = weekRow(page, '2026-08-24'), friday = weekRow(page, '2026-08-28');
    await expect(monday.locator('.overwrite-badge')).toContainText('Saved');
    await clickInView(friday.locator('.type-pill-btn[data-type="sick"]'));   // an absence staged on Friday
    await page.locator('#overridesToggleHeader').click();
    await deleteSavedChange(page, OWN_MON);
    await expect(page.locator('#listFeedback')).toContainText('Deleted: G. Miller');
    await expect(page.locator('#listFeedback'), 'nothing staged was on that day').not.toContainText('unsaved');
    // Monday is drawn as it now stands, with nothing saved; Friday's staged absence is untouched.
    await expect(monday, 'the deleted leave still showed as saved').not.toHaveClass(/has-override/);
    await expect(monday.locator('.overwrite-badge')).toHaveCount(0);
    await expect(friday.locator('.type-pill-btn[data-type="sick"]')).toHaveAttribute('aria-pressed', 'true');
    await clickInView(page.locator('#saveBtn'));
    await expect(page.locator('#formFeedback')).toContainText('1 change saved for G. Miller', { timeout: 10000 });
    expect(await writtenDays(page)).toEqual(['2026-08-28 sick']);
    expect(await page.evaluate(() => /** @type {any} */ (window).__E2E.deletedPaths), 'and the leave stays deleted')
        .toEqual([`overrides/${OWN_MON}`]);
});

// THIS DEVICE'S OWN UNSENT SAVE GOES FIRST (v25.95). A save made offline waits in the device's queue and
// shows as saved, but a delete's transaction reads the SERVER, which does not hold it yet. Just after the
// signal returned, the delete called the record already gone and said "Deleted" — then the queued save
// landed and the record was back. Now the delete waits for the queue: held while it is held, and away the
// moment it is sent. The queue is the stub's (fixtures.js → waitForPendingWrites), a model of the SDK's —
// and so is the record: the real SDK marks a record whose own save is still queued (`hasPendingWrites`),
// and online the delete asks that record first (claim-retry.js → "ONLINE, THE RECORDS FIRST"), so the
// stub is told which one it is (`pendingIds`). Marked clear, the delete would not wait, and rightly.
test('admin: a delete waits for the saves this device has not sent yet, then goes ahead', async ({ page }) => {
    await page.addInitScript((id) => {   // before the week's own seed, which keeps what is already here
        const w = /** @type {any} */ (window);
        w.__E2E = { ...(w.__E2E || {}), queuedWrites: true, pendingIds: [id] };
    }, OWN_MON);
    await openWeekWithMondayLeave(page);
    await page.locator('#overridesToggleHeader').click();
    await deleteSavedChange(page, OWN_MON);
    await expect.poll(() => page.evaluate(() => /** @type {any} */ (window).__E2E.queueWaits || 0),
        { message: 'the delete never waited for this device\'s queue' }).toBeGreaterThan(0);
    expect(await page.evaluate(() => /** @type {any} */ (window).__E2E.deletedPaths || []),
        'the delete read the server before this device\'s own save had reached it').toEqual([]);
    await expect(page.locator('#listFeedback')).not.toContainText('Deleted');
    await page.evaluate(() => /** @type {any} */ (window).__E2E.sendQueuedWrites());   // the signal returns
    await expect(page.locator('#listFeedback')).toContainText('Deleted: G. Miller', { timeout: 10000 });
    expect(await page.evaluate(() => /** @type {any} */ (window).__E2E.deletedPaths)).toEqual([`overrides/${OWN_MON}`]);
});

test('admin: booking leave on other days of the week keeps the staged edit, and the week then saves', async ({ page }) => {
    await openAdminOnThisWeek(page);
    const friday = weekRow(page, '2026-08-28');
    await clickInView(friday.locator('.type-pill-btn[data-type="sick"]'));
    await bookMondayTuesdayLeave(page);
    await expect(page.locator('#alFeedback'), 'nothing staged was on those days').not.toContainText('unsaved');
    // The booked days are drawn as saved leave; Friday's staged absence is untouched.
    for (const date of ['2026-08-24', '2026-08-25']) {
        await expect(weekRow(page, date).locator('.overwrite-badge'), `${date} did not show the leave just booked`).toContainText('Saved');
        await expect(weekRow(page, date).locator('.type-pill-btn[data-type="annual_leave"]')).toHaveAttribute('aria-pressed', 'true');
    }
    await expect(friday.locator('.type-pill-btn[data-type="sick"]')).toHaveAttribute('aria-pressed', 'true');
    await clickInView(page.locator('#saveBtn'));
    await expect(page.locator('#formFeedback')).toContainText('1 change saved for G. Miller', { timeout: 10000 });
    expect(await writtenDays(page)).toEqual(['2026-08-24 annual_leave', '2026-08-25 annual_leave', '2026-08-28 sick']);
});

// THE SAME DAY: CLEARED AND NAMED, NEVER SAVED OVER IT. The staged change was made over the day as it was;
// saving it over the day as the page's own write left it would silently undo that write. The day is drawn
// as it now stands and named where the write was made, the other staged rows stay, and setting the day
// again now saves, because the row compares with what the day holds now.
test('admin: deleting the saved change of a day with a staged edit clears that edit and says so, and the day then saves', async ({ page }) => {
    await openWeekWithMondayLeave(page);
    const monday = weekRow(page, '2026-08-24'), friday = weekRow(page, '2026-08-28');
    await clickInView(monday.locator('.type-pill-btn[data-type="sick"]'));   // re-type Monday's leave as an absence
    await expect(monday.locator('.overwrite-badge')).toContainText('Updating');
    await clickInView(friday.locator('.type-pill-btn[data-type="sick"]'));
    await page.locator('#overridesToggleHeader').click();
    await deleteSavedChange(page, OWN_MON);
    await expect(page.locator('#listFeedback')).toContainText(
        'Your unsaved change to Mon 24 Aug in Change a Shift was cleared, because that day has just changed. Set it again if you still want it.');
    await expect(monday.locator('.type-pill-btn[aria-pressed="true"]'), 'Monday still showed the cleared change').toHaveCount(0);
    await expect(monday.locator('.overwrite-badge')).toHaveCount(0);
    await expect(friday.locator('.type-pill-btn[data-type="sick"]'), 'the other staged day was lost').toHaveAttribute('aria-pressed', 'true');
    await clickInView(monday.locator('.type-pill-btn[data-type="sick"]'));   // set again, over the day as it now stands
    await clickInView(page.locator('#saveBtn'));
    await expect(page.locator('#formFeedback')).toContainText('2 changes saved for G. Miller', { timeout: 10000 });
    await expect(page.locator('#formFeedback')).not.toContainText('Someone else');
    expect(await writtenDays(page)).toEqual(['2026-08-24 sick', '2026-08-28 sick']);
});

test('admin: booking leave over a day with a staged edit clears that edit and names it in the receipt', async ({ page }) => {
    await openAdminOnThisWeek(page);
    const tuesday = weekRow(page, '2026-08-25'), friday = weekRow(page, '2026-08-28');
    await clickInView(tuesday.locator('.type-pill-btn[data-type="sick"]'));
    await clickInView(friday.locator('.type-pill-btn[data-type="sick"]'));
    await bookMondayTuesdayLeave(page);
    await expect(page.locator('#alFeedback .save-receipt')).toContainText(
        'Your unsaved change to Tue 25 Aug in Change a Shift was cleared, because that day has just changed. Set it again if you still want it.');
    await expect(tuesday.locator('.type-pill-btn[data-type="annual_leave"]'), 'Tuesday did not show the leave just booked').toHaveAttribute('aria-pressed', 'true');
    await expect(tuesday.locator('.overwrite-badge')).toContainText('Saved');
    await expect(friday.locator('.type-pill-btn[data-type="sick"]')).toHaveAttribute('aria-pressed', 'true');
    await clickInView(page.locator('#saveBtn'));
    await expect(page.locator('#formFeedback')).toContainText('1 change saved for G. Miller', { timeout: 10000 });
    expect(await writtenDays(page), "the staged absence was written over the leave just booked")
        .toEqual(['2026-08-24 annual_leave', '2026-08-25 annual_leave', '2026-08-28 sick']);
});

// …AND A COLLEAGUE'S CHANGE IS STILL REFUSED. A colleague has changed Monday, a read has brought it into the
// page under Monday's staged edit, and the page then deletes FRIDAY's saved change itself. Only Friday's row
// follows that delete: redrawing Monday from the page's records would have put the colleague's change under
// the staged edit, and the save would then have written over it.
test('admin: a colleague\'s change on a staged day is still refused after the page deletes another day\'s saved change', async ({ page }) => {
    const fridayLeave = { id: OWN_FRI, memberName: 'G. Miller', date: '2026-08-28', type: 'annual_leave', value: 'AL', note: '', source: 'manual' };
    await openWeekWithMondayLeave(page, [fridayLeave]);
    const monday = weekRow(page, '2026-08-24'), friday = weekRow(page, '2026-08-28');
    await clickInView(monday.locator('.type-pill-btn[data-type="sick"]'));   // re-type Monday's leave as an absence
    await page.evaluate((fri) => {
        const theirs = { id: 'm_2026-08-24_G.%20Miller', memberName: 'G. Miller', date: '2026-08-24', type: 'rdw', value: '14:00-22:00', note: '', source: 'manual', changedBy: 'S. Manager' };
        const w = /** @type {any} */ (window);
        w.__E2E.docs = [theirs, fri];
        w.__E2E.txDocs = [theirs, fri];
    }, fridayLeave);
    await page.locator('#overridesToggleHeader').click();
    await page.locator('#showAllOverridesBtn').click();   // the read that brings the colleague's change into the page
    await waitForReadsToLand(page, 'the All staff read never landed');
    await deleteSavedChange(page, OWN_FRI);
    await expect(page.locator('#listFeedback')).toContainText('Deleted: G. Miller');
    await expect(friday.locator('.overwrite-badge'), 'Friday follows the delete').toHaveCount(0);
    await expect(monday.locator('.type-pill-btn[data-type="sick"]'), "premise: Monday's staged edit is still on screen").toHaveAttribute('aria-pressed', 'true');
    await clickInView(page.locator('#saveBtn'));
    await expect(page.locator('#formFeedback')).toContainText(
        'Someone else has changed Mon 24 Aug since the page loaded, so nothing was saved.', { timeout: 10000 });
    expect(await writtenDays(page), "the colleague's RDW was overwritten").toEqual([]);
});

// AN ANSWER ABOUT A DAY THAT HAS CHANGED SINCE IS NOT APPLIED (review, Nov 2026). A row asked about its rest day
// and was answered "Rest day — free"; a roster import since put a shift there, arriving in a read while the row sat
// staged. The planner, reading the fresh records, stopped asking and wrote the leave over the shift — costing a day
// the answer said was free — and the commit's check, which looks at the day's own id, does not see an import.
test('admin: a rest-day answer the record has since settled is not applied, and the save says the day changed', async ({ page }) => {
    // An invented member, on whichever week of the line puts a rest day (not a Sunday) in the week of 24 Aug 2026.
    const iso = (/** @type {Date} */ d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    let who = inventedCea(), rest = '';
    for (let w = 1; w <= CONFIG.MAIN_ROSTER_WEEKS && !rest; w++) {
        const m = inventedCea(w);
        for (let d = 24; d <= 29 && !rest; d++) if (isRestShift(getBaseShift(m, new Date(2026, 7, d, 12)))) { who = m; rest = iso(new Date(2026, 7, d, 12)); }
    }
    expect(rest, 'premise: a rest day on some week of the line').not.toBe('');
    await serveInventedMember(page, who);
    await openAdminOnThisWeek(page);
    await page.locator('#fieldMember').selectOption(who.name);
    const row = weekRow(page, rest);
    await clickInView(row.locator('.type-pill-btn[data-type="annual_leave"]'));
    await clickInView(row.locator('.al-swap-btn[data-swap="no"]'));   // "Rest day — free": nothing is to be written
    await page.evaluate(({ name, date }) => {
        const imported = { id: 'imported-shift', memberName: name, date, type: 'shift', value: '07:00-15:00', note: '', source: 'roster_import' };
        const w = /** @type {any} */ (window);
        w.__E2E.docs = [imported];
        w.__E2E.txDocs = [imported];
    }, { name: who.name, date: rest });
    await page.locator('#overridesToggleHeader').click();
    await page.locator('#showAllOverridesBtn').click();   // the read that brings the import into the page
    await waitForReadsToLand(page, 'the All staff read never landed');
    await expect(row.locator('.type-pill-btn[data-type="annual_leave"]'), 'premise: the staged leave is still on screen').toHaveAttribute('aria-pressed', 'true');
    await clickInView(page.locator('#saveBtn'));
    await expect(page.locator('#formFeedback')).toContainText(
        `Someone else has changed ${fmtPeriodDate(rest)} since the page loaded, so nothing was saved.`, { timeout: 10000 });
    expect(await writtenDays(page), 'the answer said nothing is written there').toEqual([]);
});

// …AND A CLEARED CHANGE TAKES THE OVER-ALLOWANCE QUESTION WITH IT. "Save anyway" writes the batch captured
// when Save asked, and a change cleared since is still in it: answering would write what the page has just
// said it cleared. Clearing is a change to the staged rows, so the question goes, as it does after a tap.
test('admin: clearing a staged day withdraws the over-allowance question that was waiting to save it', async ({ page }) => {
    const taken = [];
    for (const m of ['06', '07']) for (let d = 1; d <= 28; d++) taken.push(`2026-${m}-${String(d).padStart(2, '0')}`);
    await page.addInitScript((dates) => {
        const w = /** @type {any} */ (window);
        w.__E2E = { ...(w.__E2E || {}), docs: [
            ...dates.map((date, i) => ({ id: `al-${i}`, memberName: 'G. Miller', date, type: 'annual_leave', value: 'AL', note: '', source: 'manual' })),
            { id: 'm_2026-08-24_G.%20Miller', memberName: 'G. Miller', date: '2026-08-24', type: 'sick', value: 'SICK', note: '', source: 'manual' }] };
    }, taken);
    await openAdminOnThisWeek(page);
    const monday = weekRow(page, '2026-08-24');
    await clickInView(monday.locator('.type-pill-btn[data-type="annual_leave"]'));   // the absence re-typed as leave, over the allowance
    await clickInView(page.locator('#saveBtn'));
    const bar = page.locator('#alConfirmBar');
    await expect(bar, 'premise: the leave is over the allowance, so Save asks').toHaveClass(/visible/);
    await page.locator('#overridesToggleHeader').click();
    await deleteSavedChange(page, 'm_2026-08-24_G.%20Miller');
    await expect(page.locator('#listFeedback')).toContainText('Your unsaved change to Mon 24 Aug in Change a Shift was cleared');
    await expect(bar, 'the question still offered to save the cleared change').not.toHaveClass(/visible/);
    await expect(page.locator('#alConfirmSaveBtn')).toBeDisabled();
    expect(await writtenDays(page)).toEqual([]);
});

// The two other own writes, each through its own card: a Recorded dates delete (admin-app.js) and a
// leave-year move (admin-leave-year.js). The cleared day is named on the card's line, not in its toast.
test('admin: a Recorded dates delete over a day with a staged edit clears that edit and names it on the card', async ({ page }) => {
    await openWeekWithMondayLeave(page);
    const monday = weekRow(page, '2026-08-24'), friday = weekRow(page, '2026-08-28');
    await clickInView(monday.locator('.type-pill-btn[data-type="sick"]'));
    await clickInView(friday.locator('.type-pill-btn[data-type="sick"]'));
    await page.locator('#alToggleHeader').click();
    await page.locator('#alBookedToggle').click();
    const del = page.locator('#alBookedBody .btn-period-delete').first();
    await clickInView(del);
    await expect(del).toHaveText('Delete?');
    await pastDoubleTap(page);
    await clickInView(del);
    // The receipt names the seeded member, read from the session rather than written beside its count.
    const me = await page.evaluate(() => JSON.parse(localStorage.getItem('myb_admin_session') ?? '{}').name);
    await expect(page.locator('#alFeedback')).toHaveText(`✓ Deleted 1 day of Annual Leave for ${me}. `
        + 'Your unsaved change to Mon 24 Aug in Change a Shift was cleared, because that day has just changed. Set it again if you still want it.');
    await expect(page.locator('#saveToast')).toHaveText(`✓ Deleted 1 day of Annual Leave for ${me}`);
    await expect(monday.locator('.type-pill-btn[aria-pressed="true"]')).toHaveCount(0);
    await expect(friday.locator('.type-pill-btn[data-type="sick"]')).toHaveAttribute('aria-pressed', 'true');
    await clickInView(page.locator('#saveBtn'));
    await expect(page.locator('#formFeedback')).toContainText('1 change saved for G. Miller', { timeout: 10000 });
    expect(await writtenDays(page)).toEqual(['2026-08-28 sick']);
});

test('admin: a leave-year move of a day with a staged edit clears that edit and names it on the panel', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-11-03T09:00:00Z'));
    await seedMemberSession(page, 'G. Miller');
    await page.addInitScript(() => {
        const w = /** @type {any} */ (window);
        w.__E2E = { ...(w.__E2E || {}), leaveYearChoice: true, docs: [{ id: 'm_2027-01-05_G.%20Miller', memberName: 'G. Miller',
            date: '2027-01-05', type: 'annual_leave', value: 'AL', note: '', source: 'manual' }] };
    });
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    await page.locator('#fieldDate').evaluate((el) => {
        /** @type {HTMLInputElement} */ (el).value = '2027-01-05';
        el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const tuesday = weekRow(page, '2027-01-05'), wednesday = weekRow(page, '2027-01-06');
    await expect(tuesday.locator('.overwrite-badge')).toContainText('Saved');
    await clickInView(tuesday.locator('.type-pill-btn[data-type="sick"]'));
    await clickInView(wednesday.locator('.type-pill-btn[data-type="sick"]'));
    await page.locator('#alToggleHeader').click();
    await clickInView(page.locator('#alLeaveYear .leaveyear-opt[data-date="2027-01-05"][data-year="2026"]'));
    await expect(page.locator('#alLeaveYearFeedback')).toHaveText('Saved — Tue 5 Jan now comes out of 2026’s allowance. '
        + 'Your unsaved change to Tue 5 Jan in Change a Shift was cleared, because that day has just changed. Set it again if you still want it.');
    await expect(tuesday.locator('.type-pill-btn[data-type="annual_leave"]'), 'Tuesday shows the moved leave').toHaveAttribute('aria-pressed', 'true');
    await expect(wednesday.locator('.type-pill-btn[data-type="sick"]')).toHaveAttribute('aria-pressed', 'true');
    await clickInView(page.locator('#saveBtn'));
    await expect(page.locator('#formFeedback')).toContainText('1 change saved for G. Miller', { timeout: 10000 });
    expect(await writtenDays(page)).toEqual(['2027-01-05 annual_leave', '2027-01-06 sick']);
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
