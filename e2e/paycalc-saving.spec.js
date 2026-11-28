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

test('paycalc: Retry beside "Not saved" saves the figure again, with nothing else typed', async ({ page }) => {
    await page.clock.setFixedTime(DAY);
    await openOctober(page, { satH: 3, satM: 0 });
    const retry = page.locator('#saveRetryBtn');
    await expect(retry, 'no Retry while nothing has failed').toBeHidden();
    await page.evaluate((k) => {   // the next write of the payslip is refused, then storage recovers
        const set = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, v) {
            if (key === k) { Storage.prototype.setItem = set; throw new DOMException('quota', 'QuotaExceededError'); }
            return set.call(this, key, v);
        };
    }, KEY);
    await page.locator('#sunH').fill('5');
    await expect(page.locator('#saveStatus')).toHaveText('⚠ Not saved — try again');
    await expect(retry).toBeVisible();
    await retry.click();
    await expect(page.locator('#saveStatus')).toHaveText('✓ Entries saved for this payslip');
    await expect(retry).toBeHidden();
    expect(await stored(page)).toMatchObject({ satH: 3, sunH: 5 });
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

test('paycalc: a take-home typed on a payslip with no hours is saved, and the receipt names it — £0 included', async ({ page }) => {
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
        await expect(page.locator('#saveStatus'), 'saved, and named as the comparison it is').toHaveText('✓ Take-home comparison saved');
    }
    await page.reload();
    await expect(page.locator('#actualNetInput')).toHaveValue('0');
    await expect(page.locator('#saveStatus')).toHaveText('✓ Take-home comparison saved');
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

// Under the longest failure the status wrapped and pushed Retry flush against "Clear all entries" (0px
// apart at 320 and 375px), and each one's touch region reaches 6px sideways: a thumb aimed at Retry
// could land on the destructive control (paycalc.css → "THE GAP KEEPS RETRY OFF").
test('paycalc: at 320px Retry under the longest failure keeps its distance from "Clear all entries"', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.clock.install({ time: DAY });
    await openOctober(page, { satH: 3, satM: 0 });
    await page.evaluate((k) => {
        const real = Storage.prototype.removeItem;
        Storage.prototype.removeItem = function (key) { if (key !== k) real.call(this, key); };
    }, KEY);
    await page.clock.pauseAt(new Date(DAY.getTime() + 60_000));
    const btn = page.locator('#clearBtn');
    await btn.click();
    await page.clock.runFor(1000);
    await btn.click();
    await expect(page.locator('#saveStatus')).toHaveText(/Couldn't clear this payslip/);
    const [status, retry, clear] = await Promise.all(['#saveStatus', '#saveRetryBtn', '#clearBtn']
        .map(async (s) => /** @type {{ x: number, width: number }} */ (await page.locator(s).boundingBox())));
    expect(retry.x - (status.x + status.width), 'Retry overlaps the status line').toBeGreaterThanOrEqual(0);
    expect(clear.x - (retry.x + retry.width), 'Retry\'s and Clear\'s touch regions (6px each) overlap').toBeGreaterThanOrEqual(12);
});

// ── THE "NOT SAVED" LINE: ITS WORDS, ITS RETRY AND WHO HEARS IT (paycalc-save-line.js) ───────────────

/** Storage refuses the NEXT write of the payslip, then recovers. @param {import('@playwright/test').Page} page */
const refuseNextWrite = (page) => page.evaluate((k) => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, v) {
        if (key === k) { Storage.prototype.setItem = set; throw new DOMException('quota', 'QuotaExceededError'); }
        return set.call(this, key, v);
    };
}, KEY);

// A setting refused while a Clear's failure stood took the words "Not saved — try again" and left the
// Clear's Retry under them: one tap deleted the payslip's entries without the two-tap confirm.
test('paycalc: a setting refused while a Clear\'s failure stands keeps the Clear\'s words, and Retry runs that Clear', async ({ page }) => {
    await page.clock.install({ time: DAY });
    await openOctober(page, { satH: 3, satM: 0 });
    await page.evaluate((k) => {   // storage refuses this payslip's deletes and writes until told otherwise
        const w = /** @type {any} */ (window), del = Storage.prototype.removeItem, set = Storage.prototype.setItem;
        w.__refuse = true;
        Storage.prototype.removeItem = function (key) { if (key === k && w.__refuse) return; return del.call(this, key); };
        Storage.prototype.setItem = function (key, v) {
            if (key === k && w.__refuse) throw new DOMException('quota', 'QuotaExceededError');
            return set.call(this, key, v);
        };
    }, KEY);
    await page.clock.pauseAt(new Date(DAY.getTime() + 60_000));
    const btn = page.locator('#clearBtn'), status = page.locator('#saveStatus'), retry = page.locator('#saveRetryBtn');
    await btn.click();
    await page.clock.runFor(1000);
    await btn.click();
    await expect(status).toHaveText(/Couldn't clear this payslip/);
    await page.locator('#pensionOptOutCheck').check();          // a setting refused too
    await expect(status, 'the words still name the Clear that Retry runs').toHaveText(/Couldn't clear this payslip/);
    await expect(retry).toBeVisible();
    await page.evaluate(() => { /** @type {any} */ (window).__refuse = false; });
    await retry.click();
    await expect(status).toHaveText('No entries saved for this payslip');
    expect(await stored(page), 'the Clear the words named is what ran').toBeNull();
});

// One setting's verified write ended ANOTHER setting's "Not saved" line and said "saved" while the
// refused one was still not stored.
test('paycalc: a setting that saves after another was refused stores the refused one too before it says saved', async ({ page }) => {
    await page.clock.setFixedTime(DAY);
    await openOctober(page, { satH: 3, satM: 0, slSkip: true });
    expect(await page.evaluate(() => /** @type {HTMLInputElement} */ (document.getElementById('slSkipCheck')).checked),
        'premise: the payslip\'s loan skip is ticked').toBe(true);
    await refuseNextWrite(page);
    await page.evaluate(() => {   // no loan at all: the skip is cleared, and carried into the payslip — refused
        const s = /** @type {HTMLSelectElement} */ (document.getElementById('studentLoan'));
        s.value = 'none'; s.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect(page.locator('#saveStatus')).toHaveText('⚠ Not saved — try again');
    expect((await stored(page)).slSkip, 'premise: the cleared skip did not reach storage').toBe(true);
    await page.locator('#pensionOptOutCheck').check();          // a different setting, which saves
    await expect(page.locator('#saveStatus')).toHaveText('✓ Entries saved for this payslip');
    expect((await stored(page)).slSkip, '"saved" means the refused skip is stored too').toBe(false);
});

/** Choose a student-loan plan, as the Settings card's select does. @param {import('@playwright/test').Page} page @param {string} v */
const chooseLoan = (page, v) => page.evaluate((value) => {
    const s = /** @type {HTMLSelectElement} */ (document.getElementById('studentLoan'));
    s.value = value; s.dispatchEvent(new Event('change', { bubbles: true }));
}, v);
/** Tick or untick the payslip's loan skip, as the member does. @param {import('@playwright/test').Page} page @param {boolean} on */
const setLoanSkip = (page, on) => page.evaluate((checked) => {
    const c = /** @type {HTMLInputElement} */ (document.getElementById('slSkipCheck'));
    c.checked = checked; c.dispatchEvent(new Event('change', { bubbles: true }));
}, on);
const loanSkipTicked = (/** @type {import('@playwright/test').Page} */ page) =>
    page.evaluate(() => /** @type {HTMLInputElement} */ (document.getElementById('slSkipCheck')).checked);

// A setting's write left the merge's base where the payslip was loaded, so the next save took this tab's
// own setting for another tab's: the skip ticked again was stored, and shown, unticked under "saved".
test('paycalc: a setting this tab saved is not mistaken for another tab\'s by the next save', async ({ page }) => {
    await page.clock.setFixedTime(DAY);
    await openOctober(page, { satH: 3, satM: 0, slSkip: true });
    await chooseLoan(page, 'plan2');
    expect(await loanSkipTicked(page), 'premise: the payslip\'s loan skip is ticked').toBe(true);
    await chooseLoan(page, 'none');                             // no loan: the skip is cleared and stored
    await expect.poll(async () => (await stored(page)).slSkip).toBe(false);
    await chooseLoan(page, 'plan2');
    await setLoanSkip(page, true);                              // the member ticks it again
    await expect(page.locator('#saveStatus')).toHaveText('✓ Entries saved for this payslip');
    expect((await stored(page)).slSkip, 'the tick is what was stored').toBe(true);
    expect(await loanSkipTicked(page), 'and the box was not unticked under "saved"').toBe(true);
    await expect(dialog(page)).toHaveCount(0);

    // Then the other tab: it unticks the skip after this tab's setting write, and this tab types a figure.
    await chooseLoan(page, 'none');
    await expect.poll(async () => (await stored(page)).slSkip).toBe(false);
    await otherTabWrites(page, { ...(await stored(page)), slSkip: true });
    await page.locator('#sunH').fill('5');
    await expect.poll(async () => (await stored(page))?.sunH).toBe(5);
    expect((await stored(page)).slSkip, 'the other tab\'s change is kept, not written over').toBe(true);
    expect(await loanSkipTicked(page), 'and this screen is brought up to it').toBe(true);
});

// A setting's read of the payslip was unchecked: storage that would not answer read as "nothing saved
// here", and the setting was dropped with nothing on screen to say so.
test('paycalc: a setting whose read of the payslip fails says "Not saved", and Retry stores it', async ({ page }) => {
    await page.clock.setFixedTime(DAY);
    await openOctober(page, { satH: 3, satM: 0, pension: 50 });
    await page.evaluate((k) => {   // reads of the payslip fail until storage recovers
        const w = /** @type {any} */ (window), get = Storage.prototype.getItem;
        w.__refuseRead = true;
        Storage.prototype.getItem = function (key) {
            if (key === k && w.__refuseRead) throw new DOMException('busy', 'UnknownError');
            return get.call(this, key);
        };
    }, KEY);
    await page.locator('#pensionOptOutCheck').check();
    await expect(page.locator('#saveStatus')).toHaveText('⚠ Not saved — try again');
    await page.evaluate(() => { /** @type {any} */ (window).__refuseRead = false; });
    await page.locator('#saveRetryBtn').click();
    await expect(page.locator('#saveStatus')).toHaveText('✓ Entries saved for this payslip');
    expect((await stored(page)).pension, 'the payslip\'s own figure lies dormant behind the lock').toBe(50);
});

// The Retry found nothing stored to carry the setting into (`write: null`), so nothing ended the line
// and "Not saved" stayed up for good over a payslip with nothing left to save.
test('paycalc: a setting\'s Retry on a payslip with no saved entries ends "Not saved"', async ({ page }) => {
    await page.clock.setFixedTime(DAY);
    await openOctober(page, null);
    await page.evaluate((k) => {   // reads of the payslip fail until storage recovers
        const w = /** @type {any} */ (window), get = Storage.prototype.getItem;
        w.__refuseRead = true;
        Storage.prototype.getItem = function (key) {
            if (key === k && w.__refuseRead) throw new DOMException('busy', 'UnknownError');
            return get.call(this, key);
        };
    }, KEY);
    await page.locator('#pensionOptOutCheck').check();
    await expect(page.locator('#saveStatus')).toHaveText('⚠ Not saved — try again');
    await page.evaluate(() => { /** @type {any} */ (window).__refuseRead = false; });
    await page.locator('#saveRetryBtn').click();
    await expect(page.locator('#saveStatus')).toHaveText('No entries saved for this payslip');
    await expect(page.locator('#saveRetryBtn')).toBeHidden();
    expect(await stored(page), 'nothing is invented for a payslip with no entries').toBeNull();
});

// The adjustment was stored as typed and shown to two decimals, so a figure past the penny came back
// as a different one, which the next edit then stored (invariant 2: the round trip is symmetric).
test('paycalc: an adjustment typed past the penny is stored as the penny figure the box shows again', async ({ page }) => {
    await page.clock.setFixedTime(DAY);
    await openOctober(page, { satH: 3, satM: 0 });
    await page.locator('#hoursShowMore').click();
    await page.locator('#otherAdj').fill('12.346');
    await expect.poll(async () => (await stored(page)).otherAdj).toBe(12.35);
    const net = await page.locator('#netDisplay').textContent();
    await page.reload();
    await expect(page.locator('#otherAdj')).toHaveValue('12.35');
    await expect(page.locator('#netDisplay'), 'reopened, the payslip prices as it did').toHaveText(String(net));
    await page.locator('#sunH').fill('2');                      // the next edit stores the same figure
    await expect.poll(async () => (await stored(page)).sunH).toBe(2);
    expect((await stored(page)).otherAdj).toBe(12.35);
});

test('paycalc: a Retry that saves hands keyboard focus to the status line, and only a change of state is spoken', async ({ page }) => {
    await page.clock.setFixedTime(DAY);
    await openOctober(page, { satH: 3, satM: 0 });
    const status = page.locator('#saveStatus'), live = page.locator('#saveStatusLive'), retry = page.locator('#saveRetryBtn');
    await page.locator('#sunH').fill('4');
    await expect(status).toHaveText('✓ Entries saved for this payslip');
    await expect(live, 'an ordinary save is not announced').toHaveText('');
    await refuseNextWrite(page);
    await page.locator('#sunH').fill('5');
    await expect(status).toHaveText('⚠ Not saved — try again');
    await expect(live, 'the line going up is announced').toHaveText('⚠ Not saved — try again');
    await retry.focus();
    await page.keyboard.press('Enter');
    await expect(status).toHaveText('✓ Entries saved for this payslip');
    await expect(retry).toBeHidden();
    await expect(status, 'focus went to the status line, not to the top of the page').toBeFocused();
    await expect(live, 'the focused line reads itself out; the region does not say it twice').toHaveText('');
    expect(await stored(page)).toMatchObject({ sunH: 5 });
});

test('paycalc: a "Not saved" ended by the next edit announces the recovery once', async ({ page }) => {
    await page.clock.setFixedTime(DAY);
    await openOctober(page, { satH: 3, satM: 0 });
    const live = page.locator('#saveStatusLive');
    await refuseNextWrite(page);
    await page.locator('#sunH').fill('5');
    await expect(live).toHaveText('⚠ Not saved — try again');
    await page.locator('#sunM').fill('15');                     // storage answers now
    await expect(page.locator('#saveStatus')).toHaveText('✓ Entries saved for this payslip');
    await expect(live, 'saved again is announced').toHaveText('✓ Entries saved for this payslip');
    await page.evaluate(() => { /** @type {HTMLElement} */ (document.getElementById('saveStatusLive')).textContent = 'heard'; });
    await page.locator('#sunM').fill('20');                     // an ordinary save after it
    await expect.poll(async () => (await stored(page))?.sunM).toBe(20);
    await expect(live, 'a later keystroke\'s save is not announced').toHaveText('heard');
});
