/**
 * paycalc-saving.spec.js — the Pay Calculator (paycalc.html): what "Entries saved" promises.
 *
 * Two promises, each reproduced before it was kept:
 *   1. TWO TABS ON ONE PAYSLIP MERGE, they do not overwrite. A save compares the payslip in storage
 *      with the version its form was opened from (`planPeriodSave`, paycalc-period-merge.js), so a
 *      stale tab keeps the other tab's figures, and a figure BOTH tabs changed is asked about.
 *   2. "SAVED" ONLY AFTER A VERIFIED WRITE. A write is read back before the status says so, and a
 *      Clear checks the payslip is really gone.
 *
 * The October 2026 payslip (paid 23 Oct, internal P57) of the seeded member, with made-up
 * hours. Storage is seeded ONCE per context (a marker key), because a reload re-runs every init script
 * and would otherwise put the seeded figures back over what the test saved.
 */
import { test, expect, appTab } from './fixtures.js';
import { collectFatalErrors, seedSession } from './helpers.js';

const KEY = 'myb_pc_gmiller_p57';
const URL = '/paycalc.html?payday=2026-10-23';
const DAY = new Date('2026-10-22T09:00:00Z');

/**
 * Open the October payslip in `page`, with `saved` in storage the first time the context opens it.
 * @param {import('@playwright/test').Page} page @param {Record<string, any>|null} saved
 */
async function openOctober(page, saved) {
    await seedSession(page);
    await page.addInitScript(([k, v]) => {
        localStorage.setItem('myb_pc_ns_migrated', '1');
        if (localStorage.getItem('__e2e_seeded') === null) {
            localStorage.setItem('__e2e_seeded', '1');
            if (v !== null) localStorage.setItem(k, v);
        }
    }, [KEY, saved === null ? null : JSON.stringify(saved)]);
    await page.goto(URL);
    await expect(page.locator('#netDisplay')).toHaveText(/£\d/);
}

/** @param {import('@playwright/test').Page} page */
const stored = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null'), KEY);

test('paycalc: two tabs editing different days of one payslip both keep their figures', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.clock.setFixedTime(DAY);
    await openOctober(page, { satH: 8, satM: 0 });
    const b = await appTab(page.context());
    await openOctober(b, null);
    await expect(page.locator('#satH')).toHaveValue('8');
    await expect(b.locator('#satH')).toHaveValue('8');

    await page.locator('#satH').fill('3');                   // tab A: Saturday 8h → 3h
    await expect.poll(async () => (await stored(page))?.satH).toBe(3);
    await b.locator('#sunH').fill('5');                      // tab B, opened before A's change: Sunday 5h
    await expect.poll(async () => (await stored(b))?.sunH).toBe(5);

    await page.reload();
    await expect(page.locator('#satH'), 'tab A\'s Saturday survived tab B\'s save').toHaveValue('3');
    await expect(page.locator('#sunH'), 'tab B\'s Sunday is kept too').toHaveValue('5');
    expect(errors).toHaveLength(0);
});

/**
 * Another tab's save, made WITHOUT this tab hearing of it: a write from this page's own script fires no
 * `storage` event here, which is what a tab that was asleep or discarded meets. So the save itself
 * must look at storage — the event is only ever a prompt.
 * @param {import('@playwright/test').Page} page @param {Record<string, any>|null} next
 */
const otherTabWrites = (page, next) => page.evaluate(([k, v]) => {
    if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v);
}, [KEY, next === null ? null : JSON.stringify(next)]);

const dialog = (/** @type {import('@playwright/test').Page} */ page) => page.locator('.dialog-overlay.visible');

test('paycalc: a save merges with another tab\'s even when this tab never heard of it', async ({ page }) => {
    await page.clock.setFixedTime(DAY);
    await openOctober(page, { satH: 8, satM: 0 });
    await otherTabWrites(page, { ...(await stored(page)), satH: 3 });   // the other tab: Saturday 8h → 3h
    await page.locator('#sunH').fill('5');                             // this tab, still showing 8h
    await expect.poll(async () => (await stored(page))?.sunH).toBe(5);
    expect((await stored(page)).satH, 'the other tab\'s Saturday is kept').toBe(3);
    await expect(page.locator('#satH'), 'and this screen is brought up to it').toHaveValue('3');
    await expect(page.locator('#saveStatus')).toHaveText(/Entries saved/);
    await expect(dialog(page), 'different rows need no question').toHaveCount(0);
});

test('paycalc: both tabs changing the same row asks which to keep, and overwrites nothing first', async ({ page }) => {
    await page.clock.setFixedTime(DAY);
    await openOctober(page, { satH: 8, satM: 0 });
    await otherTabWrites(page, { ...(await stored(page)), satH: 3, sunH: 2 });
    await page.locator('#satH').fill('6');
    await expect(dialog(page).locator('.dialog-title')).toHaveText('Changed in another tab');
    await expect(dialog(page).locator('.dialog-message')).toHaveText(
        'Another tab saved a different entry on this payslip after this one opened it. '
        + 'Rostered Saturday: 3 hrs in the other tab, 6 hrs on this screen. Which do you want to keep? '
        + 'Anything else either tab changed is kept.');
    expect((await stored(page)).satH, 'nothing is written while the question is open').toBe(3);
    await expect(page.locator('#satH'), 'this tab\'s edit stays on screen').toHaveValue('6');
    await expect(page.locator('#saveStatus')).toHaveText('⚠ Not saved — this payslip was also changed in another tab');

    await dialog(page).locator('.dialog-btn-confirm').click();         // "Keep this screen's"
    await expect(dialog(page)).toHaveCount(0);
    await expect.poll(async () => (await stored(page)).satH).toBe(6);
    expect((await stored(page)).sunH, 'the other tab\'s Sunday is kept beside it').toBe(2);
    await expect(page.locator('#sunH')).toHaveValue('2');
    await expect(page.locator('#saveStatus')).toHaveText(/Entries saved/);

    await otherTabWrites(page, { ...(await stored(page)), satH: 4 });
    await page.locator('#satH').fill('9');
    await expect(dialog(page)).toBeVisible();
    await dialog(page).locator('.dialog-btn-cancel').click();          // "Keep the other tab's"
    await expect(page.locator('#satH'), 'the other tab\'s figure comes onto the screen').toHaveValue('4');
    expect((await stored(page)).satH).toBe(4);
    await page.reload();
    await expect(page.locator('#satH'), 'what the screen showed is what was stored').toHaveValue('4');
    await expect(page.locator('#sunH')).toHaveValue('2');
});

test('paycalc: a question dismissed is "not now": nothing is written, and the next edit asks again', async ({ page }) => {
    await page.clock.setFixedTime(DAY);
    await openOctober(page, { satH: 8, satM: 0 });
    await otherTabWrites(page, { ...(await stored(page)), satH: 3 });
    await page.locator('#satH').fill('6');
    await expect(dialog(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
    expect((await stored(page)).satH).toBe(3);
    await expect(page.locator('#saveStatus')).toHaveText(/Not saved/);
    await page.locator('#satH').fill('7');
    await expect(dialog(page)).toBeVisible();
});

test('paycalc: an old tab editing a payslip cleared in another tab asks, and resurrects nothing unasked', async ({ page }) => {
    await page.clock.setFixedTime(DAY);
    await openOctober(page, { satH: 8, satM: 0 });
    await otherTabWrites(page, null);                                  // cleared in the other tab
    await page.locator('#sunH').fill('5');
    await expect(dialog(page).locator('.dialog-title')).toHaveText('Cleared in another tab');
    expect(await stored(page), 'the clear stands while the question is open').toBeNull();
    await expect(page.locator('#sunH'), 'and the edit is still on screen').toHaveValue('5');
    await dialog(page).locator('.dialog-btn-cancel').click();          // "Leave it cleared"
    await expect(page.locator('#satH')).toHaveValue('');
    await expect(page.locator('#sunH')).toHaveValue('');
    expect(await stored(page)).toBeNull();
    await expect(page.locator('#saveStatus')).toHaveText('No entries saved for this payslip');

    await page.locator('#satH').fill('2');                             // an ordinary save after it
    await expect.poll(async () => (await stored(page))?.satH).toBe(2);
    await otherTabWrites(page, null);
    await page.locator('#sunH').fill('1');
    await dialog(page).locator('.dialog-btn-confirm').click();         // "Keep this screen's"
    await expect.poll(async () => await stored(page)).toMatchObject({ satH: 2, sunH: 1 });
});

test('paycalc: a tab with nothing of its own follows a clear made in another tab', async ({ page }) => {
    await page.clock.install({ time: DAY });
    await openOctober(page, { satH: 8, satM: 0 });
    const b = await appTab(page.context());
    await openOctober(b, null);
    await expect(b.locator('#satH')).toHaveValue('8');
    await page.bringToFront();   // the two-tap Clear disarms in a hidden tab (paycalc-clear-confirm.js)
    // PAUSED, so the one second below is the only time between the taps (as paycalc-backpay.spec.js's Clear):
    // `clock.install` lets time run on, and on a busy runner the real seconds took the armed button past its
    // three and disarmed it, so the second tap armed it again and nothing was cleared.
    await page.clock.pauseAt(new Date(DAY.getTime() + 60_000));
    const btn = page.locator('#clearBtn');
    await btn.click();
    await expect(btn).toHaveText(/Select again/);
    await page.clock.runFor(1000);
    await btn.click();
    await expect.poll(() => stored(page)).toBeNull();
    await expect(b.locator('#satH'), 'the other tab shows the clear').toHaveValue('');
    await b.locator('#sunH').fill('5');
    await expect.poll(async () => await stored(b)).toMatchObject({ satH: 0, sunH: 5 });
    await expect(dialog(b)).toHaveCount(0);
});

test('paycalc: "Entries saved" appears only for a write that read back, and the typed figure stays on screen', async ({ page }) => {
    await page.clock.setFixedTime(DAY);
    await openOctober(page, { satH: 3, satM: 0 });
    await expect(page.locator('#saveStatus')).toHaveText(/Entries saved/);
    // Storage refuses this payslip's writes from here on (a full quota, say).
    await page.evaluate((k) => {
        const real = Storage.prototype.setItem;
        /** @type {any} */ (window).__realSetItem = real;
        Storage.prototype.setItem = function (key, value) {
            if (key === k) throw new DOMException('quota', 'QuotaExceededError');
            return real.call(this, key, value);
        };
    }, KEY);
    await page.locator('#satH').fill('7');
    await expect(page.locator('#saveStatus')).toHaveText('⚠ Not saved — try again');
    await expect(page.locator('#saveStatus')).not.toHaveClass(/\bsaved\b/);
    await expect(page.locator('#satH'), 'the typed figure is kept on screen').toHaveValue('7');
    expect((await stored(page)).satH, 'storage still holds the old figure').toBe(3);

    // Storage works again: the next edit saves, and only then does the page say so.
    await page.evaluate(() => { Storage.prototype.setItem = /** @type {any} */ (window).__realSetItem; });
    await page.locator('#satM').fill('15');
    await expect(page.locator('#saveStatus')).toHaveText('✓ Entries saved for this payslip');
    expect(await stored(page)).toMatchObject({ satH: 7, satM: 15 });
    await page.reload();
    await expect(page.locator('#satH'), 'reopened, storage holds what the screen showed').toHaveValue('7');
    await expect(page.locator('#satM')).toHaveValue('15');
});

// A SETTING carried into the payslip (the pension controls, the student loan) said "Entries saved" over a
// write the device had refused, so a reload lost it (24-hour check, 27 Nov 2026).
test('paycalc: a setting the payslip could not keep says "Not saved", never "Entries saved"', async ({ page }) => {
    await page.clock.setFixedTime(DAY);
    await openOctober(page, { satH: 3, satM: 0, pension: 50 });
    await expect(page.locator('#saveStatus')).toHaveText(/Entries saved/);
    await page.evaluate((k) => {
        const real = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
            if (key === k) throw new DOMException('quota', 'QuotaExceededError');
            return real.call(this, key, value);
        };
    }, KEY);
    await page.locator('#pensionOptOutCheck').check();
    await expect(page.locator('#saveStatus')).toHaveText('⚠ Not saved — try again');
    await expect(page.locator('#saveStatus')).not.toHaveClass(/\bsaved\b/);
});

// ── WHAT A SAVE OR A CLEAR REPORTS WHEN ONE READ OF STORAGE FAILS (review of v27.14) ─────────────────
// Storage refuses ONE read of the payslip at the moment that matters, as a busy or failing device can.

test('paycalc: a read that fails before a save writes nothing over another tab\'s figures, and the retry keeps both', async ({ page }) => {
    await page.clock.setFixedTime(DAY);
    await openOctober(page, null);
    // Another tab saved Saturday 3h, and this tab missed the event; the next read of the payslip fails once.
    await page.evaluate((k) => {
        localStorage.setItem(k, JSON.stringify({ satH: 3 }));
        const get = Storage.prototype.getItem;
        let once = true;
        Storage.prototype.getItem = function (key) {
            if (key === k && once) { once = false; throw new DOMException('busy', 'UnknownError'); }
            return get.call(this, key);
        };
    }, KEY);
    await page.locator('#sunH').fill('5');
    await expect(page.locator('#saveStatus')).toHaveText('⚠ Not saved — try again');
    expect(await stored(page), 'nothing was written over the other tab\'s Saturday').toEqual({ satH: 3 });
    await expect(page.locator('#sunH'), 'the typed Sunday stays on screen').toHaveValue('5');
    await page.locator('#sunM').fill('15');                    // the retry: storage answers now
    await expect(page.locator('#saveStatus')).toHaveText('✓ Entries saved for this payslip');
    expect(await stored(page)).toMatchObject({ satH: 3, sunH: 5, sunM: 15 });
});

test('paycalc: a clear that landed, whose check read failed, says the payslip is cleared', async ({ page }) => {
    await page.clock.install({ time: DAY });
    await openOctober(page, { satH: 3, satM: 0 });
    await page.clock.pauseAt(new Date(DAY.getTime() + 60_000));
    await page.evaluate((k) => {
        const del = Storage.prototype.removeItem, get = Storage.prototype.getItem;
        let fail = false;
        Storage.prototype.removeItem = function (key) { del.call(this, key); if (key === k) fail = true; };
        Storage.prototype.getItem = function (key) {
            if (fail && key === k) { fail = false; throw new DOMException('busy', 'UnknownError'); }
            return get.call(this, key);
        };
    }, KEY);
    const btn = page.locator('#clearBtn');
    await btn.click();
    await page.clock.runFor(1000);
    await btn.click();
    expect(await stored(page), 'the payslip is gone').toBeNull();
    await expect(page.locator('#saveStatus')).toHaveText('No entries saved for this payslip');
    await expect(page.locator('#satH')).toHaveValue('');
});

test('paycalc: a setting that saves after a refused one ends ITS warning, and never a warning about typed figures', async ({ page }) => {
    await page.clock.setFixedTime(DAY);
    await openOctober(page, { satH: 3, satM: 0, pension: 50 });
    await page.evaluate((k) => {   // the NEXT write of the payslip is refused, then storage recovers
        const set = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, v) {
            if (key === k) { Storage.prototype.setItem = set; throw new DOMException('quota', 'QuotaExceededError'); }
            return set.call(this, key, v);
        };
    }, KEY);
    const optOut = page.locator('#pensionOptOutCheck');
    await optOut.check();
    await expect(page.locator('#saveStatus')).toHaveText('⚠ Not saved — try again');
    await optOut.uncheck();                                     // the setting saves this time
    await expect(page.locator('#saveStatus')).toHaveText('✓ Entries saved for this payslip');

    // A refused TYPED figure is not ended by a setting that saves.
    await page.evaluate((k) => {
        const set = Storage.prototype.setItem;
        /** @type {any} */ (window).__set = set;
        Storage.prototype.setItem = function (key, v) { if (key === k) throw new DOMException('quota', 'QuotaExceededError'); return set.call(this, key, v); };
    }, KEY);
    await page.locator('#satH').fill('7');
    await expect(page.locator('#saveStatus')).toHaveText('⚠ Not saved — try again');
    await optOut.check();                                       // a setting refused too, while Saturday's warning stands
    await expect(page.locator('#saveStatus')).toHaveText('⚠ Not saved — try again');
    await page.evaluate(() => { Storage.prototype.setItem = /** @type {any} */ (window).__set; });
    await optOut.uncheck();                                     // the setting saves now
    await expect(page.locator('#saveStatus'), 'Saturday 7h is still not saved').toHaveText('⚠ Not saved — try again');
    expect((await stored(page)).satH, 'and storage still holds 3h').toBe(3);
});

test('paycalc: a take-home typed on a payslip with no hours is saved, and the receipt says so — £0 included', async ({ page }) => {
    await page.clock.install({ time: DAY });
    await openOctober(page, { satH: 3, satM: 0 });
    await page.clock.pauseAt(new Date(DAY.getTime() + 60_000));
    const btn = page.locator('#clearBtn');                       // cleared: no hours, and no calendar suggestion saved with it
    await btn.click();
    await page.clock.runFor(1000);
    await btn.click();
    await expect.poll(() => stored(page)).toBeNull();
    for (const amount of ['1750', '0']) {
        await page.locator('#actualNetInput').fill(amount);
        await expect.poll(async () => (await stored(page))?.actualNet).toBe(Number(amount));
        await expect(page.locator('#saveStatus')).toHaveText('✓ Entries saved for this payslip');
    }
    await page.reload();
    await expect(page.locator('#actualNetInput')).toHaveValue('0');
    await expect(page.locator('#saveStatus')).toHaveText('✓ Entries saved for this payslip');
});

test('paycalc: one tab saving as it always has — no question, saved as typed', async ({ page }) => {
    await page.clock.setFixedTime(DAY);
    await openOctober(page, null);
    await page.locator('#satH').fill('4');
    await page.locator('#otH').fill('2');
    await expect(page.locator('#saveStatus')).toHaveText('✓ Entries saved for this payslip');
    expect(await stored(page)).toMatchObject({ satH: 4, otH: 2 });
    await expect(dialog(page)).toHaveCount(0);
});

test('paycalc: a Clear whose delete is refused puts the stored figure back and says so', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-10-22T09:00:00Z') });
    await openOctober(page, { satH: 3, satM: 0 });
    await page.evaluate((k) => {
        const real = Storage.prototype.removeItem;
        Storage.prototype.removeItem = function (key) { if (key !== k) real.call(this, key); };
    }, KEY);
    await page.clock.pauseAt(new Date('2026-10-22T09:01:00Z'));   // the taps one second apart, whatever the runner's speed
    const btn = page.locator('#clearBtn');
    await btn.click();
    await page.clock.runFor(1000);
    await btn.click();
    await expect(page.locator('#satH'), 'the field shows what is still stored').toHaveValue('3');
    await expect(page.locator('#saveStatus')).toHaveText(/Couldn't clear/);
    await page.reload();
    await expect(page.locator('#satH')).toHaveValue('3');
});
