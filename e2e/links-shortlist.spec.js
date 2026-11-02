/**
 * Making the shortlist the saved designs (v25.09) — the PRESS, end to end.
 *
 * The rules and the transaction are unit-tested in links-shortlist.test.mjs. What only a browser
 * can prove is the wiring: that the row reaches the admin and nobody else, that the dialog names
 * what will move BEFORE anything does, that the writes are the ones the store test describes (three
 * creates at fixed ids, a soft-delete MERGE per older design), and that the picker then lists the
 * shortlist once — as saved designs, with the built-in rows gone.
 *
 * A file of its own rather than more of pages.spec.js, which another branch is editing in the same
 * week; the helpers are the shared ones.
 */
import { test, expect } from './fixtures.js';
import { seedSession, designOptions, proposalOptions, activeDesignName, openDesignSheet, sheetAction, clickDialogConfirm } from './helpers.js';
import { PROPOSALS } from '../links-proposals.js';
import { shortlistDocId } from '../links-shortlist.js';

/** The confirm dialog, by its title — the import panel carries a `.dialog-message` of its own. @param {import('@playwright/test').Page} page */
const shortlistDialog = (page) => page.getByRole('alertdialog', { name: 'Make the shortlist the saved designs' });

/** Open Links as `who`, with two older saved designs in the collection. @param {import('@playwright/test').Page} page @param {string} who */
async function openWithOlderDesigns(page, who) {
    await page.setViewportSize({ width: 1024, height: 900 });
    await seedSession(page, who);
    await page.addInitScript(() => {
        localStorage.setItem('myb_links_welcome_seen', '1');
        const w = /** @type {any} */ (window);
        w.__E2E = w.__E2E || {};
        w.__E2E.docs = [
            { id: 'old1', name: 'Closing Time — copy', patterns: {}, updatedAt: 1_750_000_000_000, updatedBy: 'G. Miller' },
            { id: 'old2', name: 'Option B', patterns: {}, updatedAt: 1_750_000_000_000, updatedBy: 'S. Silva' },
        ];
    });
    await page.goto('/links.html');
    await expect(designOptions(page)).toHaveCount(2);
}

test('links: the admin makes the shortlist the saved designs, and the older ones go to Recently deleted', async ({ page }) => {
    await openWithOlderDesigns(page, 'G. Miller');
    await page.evaluate(() => { /** @type {any} */ (window).__E2E.setWrites = []; });

    await sheetAction(page, 'saveShortlistBtn');
    // The dialog says what will move, by name and by who last saved it, before anything does.
    const msg = shortlistDialog(page).locator('.dialog-message');
    await expect(msg).toContainText('Even Step, In Step and Short Run become saved designs.');
    await expect(msg).toContainText('• Closing Time — copy (last saved by you)');
    await expect(msg).toContainText('• Option B (last saved by S. Silva)');
    expect(await page.evaluate(() => (/** @type {any} */ (window).__E2E.setWrites || []).length), 'nothing is written before the confirm').toBe(0);
    await clickDialogConfirm(page);

    await expect(page.locator('#linksSaveStatus')).toContainText('Even Step, In Step and Short Run are saved designs now.');
    await expect(page.locator('#linksSaveStatus')).toContainText('The 2 older designs are in Recently deleted');

    const writes = await page.evaluate(() => /** @type {any} */ (window).__E2E.setWrites || []);
    for (const p of PROPOSALS) {
        const w = writes.find((/** @type {any} */ x) => x.path === `linkDesigns/${shortlistDocId(p)}`);
        expect(w, `${p.name} is created at its fixed id`).toBeTruthy();
        expect(w.merge).toBe(false);
        expect(w.data.name).toBe(p.name);
        expect(w.data.revision).toBe(1);
        expect(w.data.updatedBy).toBe('G. Miller');
        expect(w.data.patterns).toEqual(p.patterns);
    }
    for (const id of ['old1', 'old2']) {
        const w = writes.find((/** @type {any} */ x) => x.path === `linkDesigns/${id}`);
        expect(w?.merge, `${id} is soft-deleted by MERGE, keeping its patterns`).toBe(true);
        expect(Object.keys(w.data).sort()).toEqual(['deletedAt', 'deletedBy']);
        expect(w.data.deletedBy).toBe('G. Miller');
    }

    // The picker lists the shortlist ONCE, as saved designs; the built-in rows are gone.
    await expect(activeDesignName(page)).toHaveText('Even Step — Dec 2026');
    await expect(designOptions(page)).toHaveCount(PROPOSALS.length);
    await expect(proposalOptions(page)).toHaveCount(0);
    for (const p of PROPOSALS) await expect(designOptions(page).filter({ hasText: p.name })).toHaveCount(1);

    // The older designs are in the bin, and the row does not come back.
    await openDesignSheet(page);
    await expect(page.locator('#designBinBtn')).toContainText('Recently deleted (2)');
    await expect(page.locator('#saveShortlistBtn')).toBeHidden();
});

test('links: cancelling the shortlist dialog writes nothing and moves nothing', async ({ page }) => {
    await openWithOlderDesigns(page, 'G. Miller');
    await page.evaluate(() => { /** @type {any} */ (window).__E2E.setWrites = []; });
    await sheetAction(page, 'saveShortlistBtn');
    await expect(shortlistDialog(page).locator('.dialog-message')).toContainText('These 2 designs move to Recently deleted');
    await shortlistDialog(page).locator('.dialog-btn-cancel').click();
    await expect(page.locator('.dialog-overlay.open')).toHaveCount(0);
    expect(await page.evaluate(() => (/** @type {any} */ (window).__E2E.setWrites || []).length)).toBe(0);
    await expect(designOptions(page)).toHaveCount(2);
    await expect(proposalOptions(page)).toHaveCount(PROPOSALS.length);
});

test('links: a designer who is not the admin is not offered the shortlist row', async ({ page }) => {
    await openWithOlderDesigns(page, 'S. Silva');
    await openDesignSheet(page);
    await expect(page.locator('#saveShortlistBtn')).toBeHidden();
    // …and the built-in shortlist is still there for them, untouched.
    await expect(proposalOptions(page)).toHaveCount(PROPOSALS.length);
});

test('links: offline, the shortlist is not saved and nothing moves', async ({ page }) => {
    await openWithOlderDesigns(page, 'G. Miller');
    await page.evaluate(() => { const e = /** @type {any} */ (window).__E2E; e.setWrites = []; e.txErrorCode = 'unavailable'; });
    await sheetAction(page, 'saveShortlistBtn');
    await clickDialogConfirm(page);
    await expect(page.locator('#linksSaveStatus')).toContainText(/Couldn’t save the shortlist|connection/);
    expect(await page.evaluate(() => (/** @type {any} */ (window).__E2E.setWrites || []).length)).toBe(0);
    await expect(designOptions(page)).toHaveCount(2);
});
