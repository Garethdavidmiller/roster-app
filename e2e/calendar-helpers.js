/**
 * calendar-helpers.js — what more than one of the Calendar specs (e2e/calendar-*.spec.js) needs. Not a
 * spec, and it holds no test.
 *
 * Moved here when calendar.spec.js was split by feature (25 Nov 2026), each declaration unchanged but
 * for its `export`. A helper only one spec uses stays in that spec, beside the tests it serves.
 */
import { expect } from './fixtures.js';

export async function openGuideSearch(page) {
    await page.goto('/');
    await expect(page.locator('#teamMemberSelect option').first()).toBeAttached();
    await page.locator('#navMenuBtn').click();
    const input = page.locator('#navGuideSearchInput');
    await expect(input).toBeVisible();
    await input.click();     // first focus triggers the lazy import
    return input;
}
