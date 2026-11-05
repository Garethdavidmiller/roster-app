/**
 * "Keep only the shortlist" (v25.09) — the PRESS, end to end.
 *
 * The rules are unit-tested in links-shortlist.test.mjs, and the move is the store's existing
 * `binIfStill`. What only a browser can prove is the wiring: that the row reaches the admin and
 * nobody else, that the dialog names what will move BEFORE anything is written, that every write is
 * a soft-delete MERGE of an older design and nothing is ever CREATED (the shortlist is read-only —
 * owner, 2 Nov 2026), that a design saved since 2 Nov is left alone, and that the picker ends with
 * the built-in shortlist as its options.
 *
 * A file of its own rather than more of pages.spec.js, which another session was editing (its Links
 * tests moved to links.spec.js on 3 Nov 2026); the helpers are the shared ones.
 */
import { test, expect } from './fixtures.js';
import { seedSession, designOptions, proposalOptions, activeDesignName, openDesignSheet, sheetAction, clickDialogConfirm } from './helpers.js';
import { PROPOSALS } from '../links-proposals.js';

const OLD = 1_750_000_000_000;   // June 2025 — long before the shortlist

/** The confirm dialog, by its title — the import panel carries a `.dialog-message` of its own. @param {import('@playwright/test').Page} page */
const keepDialog = (page) => page.getByRole('alertdialog', { name: 'Keep only the shortlist' });
/** @param {import('@playwright/test').Page} page */
const writes = (page) => page.evaluate(() => /** @type {any} */ (window).__E2E.setWrites || []);

/** Open Links as `who` with these saved designs. @param {import('@playwright/test').Page} page @param {string} who @param {any[]} docs */
async function openWith(page, who, docs) {
    await page.setViewportSize({ width: 1024, height: 900 });
    await seedSession(page, who);
    await page.addInitScript((seeded) => {
        localStorage.setItem('myb_links_welcome_seen', '1');
        const w = /** @type {any} */ (window);
        w.__E2E = w.__E2E || {};
        w.__E2E.docs = seeded;
    }, docs);
    await page.goto('/links.html');
    await expect(designOptions(page)).toHaveCount(docs.length);
    await page.evaluate(() => { /** @type {any} */ (window).__E2E.setWrites = []; });
}

const twoOlder = [
    { id: 'old1', name: 'Closing Time — copy', patterns: {}, updatedAt: OLD, updatedBy: 'G. Miller' },
    { id: 'old2', name: 'Option B', patterns: {}, updatedAt: OLD, updatedBy: 'S. Silva' },
];

test('links: the admin keeps only the shortlist — the older designs go to Recently deleted, and nothing is created', async ({ page }) => {
    await openWith(page, 'G. Miller', twoOlder);
    await expect(proposalOptions(page)).toHaveCount(PROPOSALS.length);

    await sheetAction(page, 'keepShortlistBtn');
    const msg = keepDialog(page).locator('.dialog-message');
    await expect(msg).toContainText('Common Ground, Even Step and Short Run stay in the list as they are now — built in and read-only.');
    await expect(msg).toContainText('• Closing Time — copy (last saved by you)');
    await expect(msg).toContainText('• Option B (last saved by S. Silva)');
    expect(await writes(page), 'nothing is written before the confirm').toEqual([]);
    await clickDialogConfirm(page);

    await expect(page.locator('#linksSaveStatus')).toContainText('The 2 older designs are in Recently deleted, so the shortlist is what is left');
    const w = await writes(page);
    expect(w.map((/** @type {any} */ x) => x.path).sort()).toEqual(['linkDesigns/old1', 'linkDesigns/old2']);
    for (const x of w) {
        expect(x.merge, `${x.path} is soft-deleted by MERGE, keeping its patterns`).toBe(true);
        expect(Object.keys(x.data).sort()).toEqual(['deletedAt', 'deletedBy']);
        expect(x.data.deletedBy).toBe('G. Miller');
    }
    expect(w.filter((/** @type {any} */ x) => x.added || !x.merge), 'the shortlist is read-only: no design is created or replaced').toEqual([]);

    // The options left are the built-in shortlist, and the open design gave way to the first of them, read-only.
    await expect(designOptions(page)).toHaveCount(0);
    await expect(proposalOptions(page)).toHaveCount(PROPOSALS.length);
    await expect(activeDesignName(page)).toHaveText(PROPOSALS[0].name);
    await expect(page.locator('#designEyebrow')).toHaveText('Shortlisted proposal');

    await openDesignSheet(page);
    await expect(page.locator('#designBinBtn')).toContainText('Recently deleted (2)');
    await expect(page.locator('#keepShortlistBtn'), 'nothing older is left, so the row goes').toBeHidden();
});

test('links: a design saved since 2 Nov 2026 is not one of the older ones, and stays', async ({ page }) => {
    await openWith(page, 'G. Miller', [
        twoOlder[0],
        { id: 'new1', name: 'Even Step — tweaked', patterns: {}, updatedAt: Date.now(), updatedBy: 'M. Robson' },
    ]);
    await sheetAction(page, 'keepShortlistBtn');
    const msg = keepDialog(page).locator('.dialog-message');
    await expect(msg).toContainText('This older design moves to Recently deleted');
    await expect(msg).not.toContainText('Even Step — tweaked');
    await clickDialogConfirm(page);
    await expect(page.locator('#linksSaveStatus')).toContainText('The older design is in Recently deleted');
    expect((await writes(page)).map((/** @type {any} */ x) => x.path)).toEqual(['linkDesigns/old1']);
    await expect(designOptions(page)).toHaveCount(1);
    await expect(designOptions(page).first()).toContainText('Even Step — tweaked');
    await expect(activeDesignName(page)).toHaveText('Even Step — tweaked');
});

test('links: cancelling Keep only the shortlist writes nothing and moves nothing', async ({ page }) => {
    await openWith(page, 'G. Miller', twoOlder);
    await sheetAction(page, 'keepShortlistBtn');
    await expect(keepDialog(page).locator('.dialog-message')).toContainText('These 2 older designs move to Recently deleted');
    await keepDialog(page).locator('.dialog-btn-cancel').click();
    await expect(page.locator('.dialog-overlay.open')).toHaveCount(0);
    expect(await writes(page)).toEqual([]);
    await expect(designOptions(page)).toHaveCount(2);
});

test('links: a designer who is not the admin is not offered Keep only the shortlist', async ({ page }) => {
    await openWith(page, 'S. Silva', twoOlder);
    await openDesignSheet(page);
    await expect(page.locator('#keepShortlistBtn')).toBeHidden();
    await expect(proposalOptions(page)).toHaveCount(PROPOSALS.length);
});

test('links: offline, Keep only the shortlist moves nothing and says so', async ({ page }) => {
    await openWith(page, 'G. Miller', twoOlder);
    await page.evaluate(() => { /** @type {any} */ (window).__E2E.txErrorCode = 'unavailable'; });
    await sheetAction(page, 'keepShortlistBtn');
    await clickDialogConfirm(page);
    await expect(page.locator('#linksSaveStatus')).toContainText('2 designs could not be moved — check your connection');
    expect(await writes(page)).toEqual([]);
    await expect(designOptions(page)).toHaveCount(2);
});
