/**
 * admin-leave-spare.spec.js — Admin (admin.html): leave in a Spare week — what the preview and the
 * receipt say it costs.
 *
 * Split by feature out of admin.spec.js on 25 Nov 2026, test for test and unchanged; what more than
 * one admin-*.spec.js file needs is in admin-helpers.js. admin.spec.js had itself been split out of
 * pages.spec.js on 3 Nov 2026; the tests that span pages, and the shared drawer, dialogs and sheets,
 * stay there.
 */
import { test, expect } from './fixtures.js';
import { seedSession, clickInView } from './helpers.js';
import { teamMembers, getBaseShift, isBankHoliday, formatISO } from '../roster-data.js';

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

// A SPARE WEEK COSTS AT MOST FOUR DAYS (owner, 21 Nov 2026). The rule is unit-tested in
// al-entitlement.test.mjs and the booking's week pass in admin-al-projection.test.mjs; this drives the
// real card, because the preview's total and its Spare line read the projection through admin-al.js.
test('admin: booking a whole Spare week off previews four days, and says why', async ({ page }) => {
    await seedSession(page, 'G. Miller');
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    // A Monday-to-Saturday Spare week, found from the roster for the reason the test above gives, with
    // no bank holiday in it and inside one month, so one page of the picker holds both ends.
    const pick = await page.evaluate(async () => {
        const rd = await import('./roster-data.js');
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const iso = (/** @type {Date} */ d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        for (const m of rd.teamMembers) {
            if (m.hidden || m.managerOnly || (m.role !== 'CEA' && m.role !== 'CES')) continue;
            for (let i = 1; i <= 200; i++) {
                const mon = new Date(today); mon.setDate(mon.getDate() + i);
                if (mon.getDay() !== 1) continue;
                const week = Array.from({ length: 6 }, (_, k) => { const d = new Date(mon); d.setDate(d.getDate() + k); return d; });
                if (week[5].getMonth() !== mon.getMonth()) continue;
                if (!week.every(d => rd.getBaseShift(m, d) === 'SPARE' && !rd.isBankHoliday(d))) continue;
                return { name: m.name, from: iso(week[0]), to: iso(week[5]),
                    monthsAhead: (mon.getFullYear() - today.getFullYear()) * 12 + (mon.getMonth() - today.getMonth()) };
            }
        }
        return null;
    });
    expect(pick, 'no CEA/CES member has a whole Spare week inside one month in the next 200 days').not.toBeNull();
    const p = /** @type {any} */ (pick);

    await page.locator('#fieldMember').selectOption(p.name);
    await page.locator('#alToggleHeader').click();
    await expect(page.locator('#alRangePicker')).toBeVisible();
    for (let i = 0; i < p.monthsAhead; i++) {
        await page.locator('#alRpNext').click();
        await page.waitForTimeout(60);
    }
    await page.locator(`#alRpGrid .rp-day[data-iso="${p.from}"]`).click();
    await page.locator(`#alRpGrid .rp-day[data-iso="${p.to}"]`).click();

    const preview = page.locator('#alPreview');
    await expect(preview).toContainText('4 days of Annual Leave');
    await expect(preview).toContainText('2 days recorded at no cost');
    await expect(preview).toContainText('6 of these days are Spare days');
    await expect(preview).toContainText('A Spare week uses at most 4 days of annual leave, so they use 4 days.');
    await expect(preview).not.toContainText('Each still uses 1 day');
});

// ONE DAY OF A SPARE WEEK WHOSE FOUR ARE ALREADY BOOKED (review, 22 Nov 2026). The Monday is the week's
// first, so it takes one of the four and the Saturday stops costing: the balance does not move. The
// headline said "No days" while the Spare line said "It still uses 1 day", and the receipt said
// "Recorded 0 days" of a day it had written. All three now say the day is recorded at no cost, and why.
/** The first CEA or CES Monday-to-Saturday Spare week inside one month in the next 200 days, found from the
 *  roster in Node — never by name, and before the page loads, so saved leave can be seeded into its first
 *  load (a save's receipt needs the session that load establishes). */
function nextSpareWeek() {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const pick = teamMembers.map(m => {
        if (m.hidden || m.managerOnly || (m.role !== 'CEA' && m.role !== 'CES')) return null;
        for (let i = 1; i <= 200; i++) {
            const mon = new Date(today); mon.setDate(mon.getDate() + i);
            if (mon.getDay() !== 1) continue;
            const week = Array.from({ length: 6 }, (_, k) => { const d = new Date(mon); d.setDate(d.getDate() + k); return d; });
            if (week[5].getMonth() !== mon.getMonth()) continue;
            if (!week.every(d => getBaseShift(m, d) === 'SPARE' && !isBankHoliday(d))) continue;
            return { name: m.name, week: week.map(d => formatISO(d)),
                monthsAhead: (mon.getFullYear() - today.getFullYear()) * 12 + (mon.getMonth() - today.getMonth()) };
        }
        return null;
    }).find(Boolean);
    expect(pick, 'no CEA/CES member has a whole Spare week inside one month in the next 200 days').toBeTruthy();
    return /** @type {any} */ (pick);
}

/** Open Admin on `p`'s leave card at its Spare week, with `docs` saved, and pick `from`–`to`.
 *  @param {import('@playwright/test').Page} page @param {any} p @param {any[]} docs @param {string} from @param {string} to */
async function bookInSpareWeek(page, p, docs, from, to) {
    await seedSession(page, 'G. Miller');
    await page.addInitScript((rows) => {
        /** @type {any} */ (window).__E2E = Object.assign(/** @type {any} */ (window).__E2E || {}, { authUser: true, docs: rows });
    }, docs);
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    await page.locator('#fieldMember').selectOption(p.name);
    await page.locator('#alToggleHeader').click();
    await expect(page.locator('#alRangePicker')).toBeVisible();
    for (let i = 0; i < p.monthsAhead; i++) { await page.locator('#alRpNext').click(); await page.waitForTimeout(60); }
    await page.locator(`#alRpGrid .rp-day[data-iso="${from}"]`).click();
    await page.locator(`#alRpGrid .rp-day[data-iso="${to}"]`).click();
}

test('admin: booking one day of a Spare week whose four are booked says it costs nothing, and why', async ({ page }) => {
    const p = nextSpareWeek();
    // Wednesday to Saturday already booked: four days, the week's whole cost.
    const docs = p.week.slice(2).map((/** @type {string} */ date, /** @type {number} */ i) =>
        ({ id: `sw${i}`, memberName: p.name, date, type: 'annual_leave', value: 'AL', note: '', source: 'manual' }));
    await bookInSpareWeek(page, p, docs, p.week[0], p.week[0]);

    const preview = page.locator('#alPreview');
    await expect(preview).toContainText('No days of Annual Leave');
    await expect(preview).toContainText('1 day recorded at no cost');
    await expect(preview).toContainText('This is a Spare day');
    await expect(preview).toContainText('this week\'s 4 are already booked, so it uses none.');
    await expect(preview).not.toContainText('It still uses 1 day');

    await clickInView(page.locator('#alSaveBtn'));
    await expect(page.locator('#alFeedback')).toContainText(
        `Recorded 1 day of Annual Leave for ${p.name} at no cost — this Spare week’s 4 days were already booked`, { timeout: 10000 });
    await expect(page.locator('#alFeedback')).not.toContainText('Recorded 0 days');
});

// A SPARE WEEK OVER NEW YEAR SPENDS ITS FOUR ACROSS TWO ALLOWANCES (external review of v26.55). With Wednesday 30
// December to Saturday 2 January booked, two count in each year; adding Monday 28 December makes it three in 2026
// and one in 2027. The total is unchanged, and the preview and the receipt both said the Monday was "at no cost".
test('admin: a December day that moves a charge out of January says so per year, never "at no cost"', async ({ page }) => {
    const NY = ['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02'];
    test.skip(new Date() >= new Date('2026-12-28T00:00:00'), 'the 2026/27 New Year week is no longer ahead, so the range picker cannot book it');
    const m = teamMembers.find(t => !t.hidden && !t.managerOnly && (t.role === 'CEA' || t.role === 'CES')
        && NY.every(d => getBaseShift(t, new Date(`${d}T12:00:00`)) === 'SPARE'));
    expect(m, 'premise: a CEA or CES member is Spare over New Year 2026/27').toBeTruthy();
    const today = new Date();
    const p = { name: /** @type {any} */ (m).name, week: NY, monthsAhead: (2026 - today.getFullYear()) * 12 + (11 - today.getMonth()) };
    const docs = NY.slice(2).map((date, i) => ({ id: `ny${i}`, memberName: p.name, date, type: 'annual_leave', value: 'AL', note: '', source: 'manual' }));
    await bookInSpareWeek(page, p, docs, NY[0], NY[0]);

    const preview = page.locator('#alPreview');
    await expect(preview).toContainText('1 day of Annual Leave');
    await expect(preview).toContainText('1 day from 2026, 1 day back to 2027');
    await expect(preview).not.toContainText('at no cost');

    await clickInView(page.locator('#alSaveBtn'));
    await expect(page.locator('#alFeedback')).toContainText(
        `Recorded 1 day of Annual Leave for ${p.name} — 1 day from 2026, 1 day back to 2027`, { timeout: 10000 });
    await expect(page.locator('#alFeedback')).not.toContainText('at no cost');
});

// THE SPARE LINE COUNTS THE WEEK AS ROSTERED, AS THE HEADLINE DOES (owner, 22 Nov 2026). A week the roster
// upload had partly assigned read "5 of these days are Spare days … so they use 3 days" under "4 days",
// because the line counted only the days still Spare while the cap counts the whole week.
test('admin: a partly assigned Spare week booked whole — the Spare line\'s figure is the headline\'s', async ({ page }) => {
    const p = nextSpareWeek();
    const tue = { id: 'ri1', memberName: p.name, date: p.week[1], type: 'shift', value: '06:00-14:00', note: '', source: 'roster_import' };
    await bookInSpareWeek(page, p, [tue], p.week[0], p.week[5]);
    const preview = page.locator('#alPreview');
    await expect(preview).toContainText('4 days of Annual Leave');
    await expect(preview).toContainText('5 of these days are Spare days');
    await expect(preview).toContainText('A Spare week uses at most 4 days of annual leave, so the 6 days booked in that week use 4 days.');
    await expect(preview).not.toContainText('use 3 days');
});

// …AND A DAY THE ROSTER HAD ASSIGNED, FREED BY THE CAP, SAYS WHY (owner, 22 Nov 2026): the preview said
// "+ 1 day recorded at no cost" with no line, because the day was not a Spare day any more.
test('admin: one assigned day of a Spare week whose four are booked says why it costs nothing', async ({ page }) => {
    const p = nextSpareWeek();
    const docs = [
        { id: 'ri1', memberName: p.name, date: p.week[0], type: 'shift', value: '06:00-14:00', note: '', source: 'roster_import' },
        ...p.week.slice(2).map((/** @type {string} */ date, /** @type {number} */ i) =>
            ({ id: `sw${i}`, memberName: p.name, date, type: 'annual_leave', value: 'AL', replacedType: 'shift', note: '', source: 'manual' })),
    ];
    await bookInSpareWeek(page, p, docs, p.week[0], p.week[0]);
    const preview = page.locator('#alPreview');
    await expect(preview).toContainText('No days of Annual Leave');
    await expect(preview).toContainText('1 day recorded at no cost');
    await expect(preview).toContainText('This day is in a Spare week, with its shift since assigned. A Spare week uses at most 4 days of annual leave, and this week\'s 4 are already booked, so it uses none.');
    await expect(preview).not.toContainText('on standby');
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
