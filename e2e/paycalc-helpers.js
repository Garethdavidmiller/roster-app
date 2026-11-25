/**
 * paycalc-helpers.js — what more than one of the Pay Calculator specs (e2e/paycalc-*.spec.js) needs:
 * the roster rows they sign in as and the page openers. Not a spec, and it holds no test.
 *
 * Moved here when paycalc.spec.js was split by feature (25 Nov 2026), each declaration unchanged but
 * for its `export`. A helper only one spec uses stays in that spec, beside the tests it serves.
 */
import { expect } from './fixtures.js';
import { seedSession } from './helpers.js';
import { teamMembers } from '../roster-data.js';
import { memberSlug } from '../paycalc-migrations.js';

/** The 5 May 2026 joiner: employed for none of 2025/26, and two 2026/27 payslips before the start. */
export const JOINER = /** @type {string} */ (teamMembers.find(m => m.role === 'CEA' && m.startDate instanceof Date
    && m.startDate.getTime() === new Date(2026, 4, 5).getTime())?.name);
/** The row promoted from CEA to CES on Sun 22 Nov 2026: its last CEA day is Sat 21 Nov. */
export const PROMOTED = /** @type {string} */ (teamMembers.find(m => m.role === 'CES' && m.roleHistory?.length === 1
    && m.roleHistory[0].role === 'CEA' && m.roleHistory[0].until.getTime() === new Date(2026, 10, 21).getTime())?.name);
/** A CEA employed all of 2025/26 who is NOT the developer account (whose device offers the actuals sheet). */
export const LONG_SERVING = /** @type {string} */ (teamMembers.find(m => m.role === 'CEA' && !m.hidden && !m.managerOnly
    && !m.startDate && !m.roleHistory && m.name !== 'G. Miller')?.name);
export const LONG_SERVING_PC = `myb_pc_${memberSlug(LONG_SERVING)}_`;

// THE CLOCK IS PINNED for Fill-the-year and for the joiner pair further down (test audit, 7 Nov 2026
// — PAY-19). Each is about the 2026/27 tax year — the year whose payslips a bulk fill reaches, and the
// joiner's first — and on the real clock the page opens on whatever tax year today is in, so from
// April 2027 they would quietly be testing a different year: a fill that never goes near the seeded
// payslip, and a joiner employed the whole year through. 7 Nov 2026 is the day these were last read
// against the real clock, with identical results.
export const PAY_2026_27_DAY = new Date('2026-11-07T09:00:00Z');

export const PT_QUIET = () => {
    localStorage.setItem('myb_pc_ns_migrated', '1');
    localStorage.setItem('myb_pc_ytd_notice_2_shown', '1');
};

/** Parse a rendered "£3,122.27" into a number. */
export const poundsOf = (/** @type {string|null} */ s) => parseFloat(String(s ?? '').replace(/[^0-9.]/g, ''));

export const LUMP_QUIET = () => {
    localStorage.setItem('myb_pc_ns_migrated', '1');
    localStorage.setItem('myb_pc_ytd_notice_2_shown', '1');
};

export const AUDIT_DAY = new Date('2026-07-15T09:00:00Z');

/** Calculated, and the calendar read answered, so the roster card and its rows are drawn. Not
 *  `waitForPageSettled`: the pinned clock suppresses `performance.mark`, which it waits on. */
export async function payPageReady(page) {
    await expect(page.locator('#netDisplay')).toHaveText(/£\d/);
    await expect.poll(() => page.evaluate(async () =>
        (await import('./paycalc-roster-suggestions.js')).getOverridesFetchState()),
        { message: 'the recorded-changes read never answered' }).not.toBe('checking');
}

/** A returning member: settings saved, so Your Settings starts SHUT, as it does for everyone after
 *  their first visit; the one-time notices out of the way. */
export async function openReturning(page, size = { width: 1366, height: 768 }) {
    await page.clock.setFixedTime(AUDIT_DAY);
    await page.setViewportSize(size);
    await seedSession(page);
    await page.addInitScript(PT_QUIET);
    await page.addInitScript(() => { localStorage.setItem('myb_pc_gmiller_setup', '1'); });
    await page.goto('/paycalc.html');
    await payPageReady(page);
}
