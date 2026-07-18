// axe.spec.js — automated accessibility gate.
//
// Runs the axe-core engine against ONE representative, fully-rendered state of every page
// (the review's recommendation: scan a real state, not the pre-load blank page). It is a
// FLOOR — axe catches the machine-checkable ~third of WCAG issues (labels, names, contrast,
// ARIA, duplicate ids), not everything — so it complements, never replaces, a manual
// screen-reader pass. NOT part of `npm test`; run with `npm run test:a11y`.
//
// When a violation is a conscious, documented trade-off rather than a bug, waive it by id in
// GLOBAL_WAIVERS (with a reason) rather than weakening the scan.

// test/expect come from fixtures.js (NOT @playwright/test) so the hermetic Firebase stub is
// installed — otherwise the SDK-dependent pages never render and the scan can't reach them.
import { test, expect } from './fixtures.js';
import AxeBuilder from '@axe-core/playwright';
import { seedSession, seedMember } from './helpers.js';

// WCAG 2.0 + 2.1, levels A and AA — the standard staff-facing target.
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

// Rules waived everywhere, each with a reason. Keep this list SHORT and justified — a waiver is
// a decision to accept a known gap, not a way to silence noise.
const GLOBAL_WAIVERS = [];

/**
 * Run axe against the current page state and return the violations, most-impactful first.
 * @param {import('@playwright/test').Page} page
 * @param {string[]} [pageWaivers]  extra rule ids to disable for this page only
 */
async function scan(page, pageWaivers = []) {
    const results = await new AxeBuilder({ page })
        .withTags(WCAG_TAGS)
        .disableRules([...GLOBAL_WAIVERS, ...pageWaivers])
        .analyze();
    return results.violations;
}

/** Render a violation list into a readable failure message. */
function report(violations) {
    if (!violations.length) return '';
    const order = { critical: 0, serious: 1, moderate: 2, minor: 3 };
    const sorted = [...violations].sort((a, b) => (order[a.impact] ?? 9) - (order[b.impact] ?? 9));
    return '\n' + sorted.map(v => {
        const nodes = v.nodes.slice(0, 3).map(n => `      - ${n.target.join(' ')}`).join('\n');
        const more = v.nodes.length > 3 ? `\n      …+${v.nodes.length - 3} more` : '';
        return `  [${(v.impact || '?').toUpperCase()}] ${v.id}: ${v.help}\n    ${v.helpUrl}\n${nodes}${more}`;
    }).join('\n\n') + '\n';
}

// Tagged @a11y so it is EXCLUDED from the default `npm run test:e2e` (via --grep-invert) and run
// only by `npm run test:a11y`. It is not yet a blocking gate: it currently reports two rule types
// of pre-existing debt (see the header note / A11Y_FINDINGS below) that are being worked through
// fix-vs-waive. Once those are resolved or consciously waived, drop the grep-invert to make it block.
test.describe('accessibility (axe-core)', { tag: '@a11y' }, () => {
    test('calendar (index.html)', async ({ page }) => {
        await seedMember(page);
        await page.goto('/');
        await expect(page.locator('.calendar-day').first()).toBeVisible();
        const v = await scan(page);
        expect(v.length, report(v)).toBe(0);
    });

    test('admin (signed in)', async ({ page }) => {
        await seedSession(page);
        await page.goto('/admin.html');
        await page.waitForSelector('.day-row', { timeout: 10000 });
        const v = await scan(page);
        expect(v.length, report(v)).toBe(0);
    });

    test('paycalc (signed in)', async ({ page }) => {
        await seedSession(page);
        await page.addInitScript(() => {
            localStorage.setItem('myb_pc_pay_welcome_shown', '1');
            localStorage.setItem('myb_pc_ytd_notice_shown', '1');
            localStorage.setItem('myb_pc_ns_migrated', '1');
        });
        await page.goto('/paycalc.html');
        await expect(page.locator('#settingsCard')).toBeVisible();
        await page.waitForTimeout(500);
        const v = await scan(page);
        expect(v.length, report(v)).toBe(0);
    });

    test('operations (admin, signed in)', async ({ page }) => {
        await seedSession(page, 'G. Miller');
        await page.addInitScript(() => localStorage.setItem('myb_email_check_done_G. Miller', '1'));
        await page.goto('/operations.html');
        await expect(page.locator('#huddleUploadCard')).toBeVisible();
        const v = await scan(page);
        expect(v.length, report(v)).toBe(0);
    });

    test('settings (signed in)', async ({ page }) => {
        await seedSession(page);
        await page.goto('/settings.html');
        await expect(page.locator('#contactToggleHeader')).toBeVisible();
        const v = await scan(page);
        expect(v.length, report(v)).toBe(0);
    });

    test('links (designer, signed in)', async ({ page }) => {
        await seedSession(page, 'G. Miller');
        await page.addInitScript(() => localStorage.setItem('myb_links_beta_seen', '1'));
        await page.goto('/links.html');
        await expect(page.locator('#generatorToggleHeader')).toBeVisible();
        const v = await scan(page);
        expect(v.length, report(v)).toBe(0);
    });

    // Static guide pages — no auth, no async state.
    for (const guide of ['guide.html', 'paycalc-guide.html', 'railcard-guide.html', 'fip.html']) {
        test(`guide (${guide})`, async ({ page }) => {
            await page.goto(`/${guide}`);
            await expect(page.locator('h1').first()).toBeVisible();
            const v = await scan(page);
            expect(v.length, report(v)).toBe(0);
        });
    }
});
