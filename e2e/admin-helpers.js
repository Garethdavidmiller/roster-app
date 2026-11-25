/**
 * admin-helpers.js — what more than one of the Admin specs (e2e/admin-*.spec.js) needs: the invented
 * member, the page openers, and the read and write probes. Not a spec, and it holds no test.
 *
 * Moved here when admin.spec.js was split by feature (25 Nov 2026), each declaration unchanged but for
 * its `export`. A helper only one spec uses stays in that spec, beside the tests it serves.
 */
import { expect } from './fixtures.js';
import { seedSession, seedMember, seedMemberSession, waitForReadsToLand } from './helpers.js';

// AN INVENTED MEMBER, SERVED INTO THE ROSTER FILE FOR ONE TEST (as paycalc-grades.spec.js serves its promoted manager).
// A test that puts leave, an absence or a rest-day change on somebody uses this, never a colleague looked up
// from `teamMembers`: the page prints the member's name beside the record ("Deleted 1 absence day for …"), and
// a failing assertion copies that line into the CI log.
/** A main-line CEA who exists only in the test. @param {number} [currentWeek] */
export const inventedCea = (currentWeek = 1) => ({ name: 'Q. Example', currentWeek, rosterType: 'main', role: 'CEA' });
/** @param {import('@playwright/test').Page} page @param {ReturnType<typeof inventedCea>} member */
export async function serveInventedMember(page, member) {
    await page.route('**/roster-member-data.js', async (route) => {
        const res = await route.fetch();
        const entry = `{ name: '${member.name}', currentWeek: ${member.currentWeek}, rosterType: '${member.rosterType}', role: '${member.role}' }`;
        const body = (await res.text()).replace(/\n\];\s*$/, `\n    ${entry},\n];\n`);
        expect(body, 'premise: the invented member reached the served roster').toContain(member.name);
        await route.fulfill({ response: res, body });
    });
}

/** Open Admin on a FUTURE week (Mon 7 Dec 2026). The Calendar drops a stored future month, so only
 *  the Calendar pill's `?date=` can get a member there (whole-app review, B3). The MEMBER seeder,
 *  because the Calendar's gate shows a sign-in card to a session with no identity behind it.
 *  @param {import('@playwright/test').Page} page */
export async function openAdminOnDecember(page) {
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

/** Open Admin on this week (Thu 27 Aug 2026) with the clock fixed at midday UTC, so the local date
 *  is the same in any time zone the runner is in. @param {import('@playwright/test').Page} page */
export async function openAdminOnThisWeek(page) {
    await page.clock.setFixedTime(new Date('2026-08-27T12:00:00Z'));
    await seedMemberSession(page, 'G. Miller');
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
    await waitForReadsToLand(page);
    await expect(page.locator('.day-row.today')).toHaveAttribute('data-date', '2026-08-27');
}

// THE RECORDED-LEAVE LIST OPENS ON THE CURRENT YEAR, and these four tests seed 2026 leave and expect
// to read it there (test audit, 7 Nov 2026). On the real clock, from 1 Jan 2027 the list opens on 2027 —
// which holds G. Miller's and S. Silva's Christmas 2027 leave, so it is not empty and nothing falls back
// — and all four failed (proved with the clock pinned to 4 Jan 2027). They are about the year chips
// and the delete controls, not about today, so they pin a 2026 day. So do three more further down
// that seed 2026 leave — the year scroll, the stale delete and the over-limit message — which the
// whole Chromium suite, run with the clock pinned to 4 Jan and 1 Mar 2027, found failing the same way.
export const LEAVE_LIST_DAY = new Date('2026-11-03T09:00:00Z');

/** Admin at a desk-sized window on a fixed Wednesday (15 Jul 2026), as the audit shot it.
 *  @param {import('@playwright/test').Page} page @param {{ width: number, height: number }} size
 *  @param {any[]} [docs] */
export async function deskAdmin(page, size, docs = []) {
    await page.clock.setFixedTime(new Date('2026-07-15T09:00:00Z'));
    await page.setViewportSize(size);
    await seedSession(page, 'G. Miller');
    await seedMember(page, 'G. Miller');   // the member on screen, or the grid opens on the roster's first name
    await page.addInitScript((d) => { const w = /** @type {any} */ (window); w.__E2E = Object.assign(w.__E2E || {}, { docs: d }); }, docs);
    await page.goto('/admin.html');
    await page.waitForSelector('.day-row', { timeout: 10000 });
}
