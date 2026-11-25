/**
 * admin-rest-day-swap.spec.js — Admin (admin.html): leave on a rest day — the swap question on the AL
 * card and the week grid, and what each answer writes.
 *
 * Split by feature out of admin.spec.js on 25 Nov 2026, test for test and unchanged; what more than
 * one admin-*.spec.js file needs is in admin-helpers.js. admin.spec.js had itself been split out of
 * pages.spec.js on 3 Nov 2026; the tests that span pages, and the shared drawer, dialogs and sheets,
 * stay there.
 */
import { test, expect } from './fixtures.js';
import { seedSession, clickInView, waitForReadsToLand } from './helpers.js';

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
    // A write needs the signed-in Firebase user: the answered save at the end goes ahead.
    await page.addInitScript(() => { window.__E2E = { ...(window.__E2E || {}), authUser: true }; });
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
    // …and the question is PUT on the row (review, Nov 2026): the refusal named one nobody could see, and
    // re-picking AL asked nothing either, so Discard was the only way out. Answered, the save goes ahead.
    await expect(row.locator('.col-al-swap'), 'the refusal puts its question on screen').toBeVisible();
    await clickInView(row.locator('.al-swap-btn[data-swap="yes"]'));
    await clickInView(page.locator('#saveBtn'));
    await expect(page.locator('#formFeedback')).toContainText(`1 change saved for ${t.name}`, { timeout: 10000 });
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
