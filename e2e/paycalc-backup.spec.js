/**
 * paycalc-backup.spec.js — the Pay Calculator (paycalc.html): backing up and restoring pay data, the
 * share sheet, and a browser that will not save.
 *
 * Split by feature out of paycalc.spec.js on 25 Nov 2026, test for test and unchanged; what more than
 * one paycalc-*.spec.js file needs is in paycalc-helpers.js, including the roster rows these tests sign
 * in as, which are chosen by shape and never written down (payroll-anonymity.test.mjs).
 */
import { test, expect } from './fixtures.js';
import { collectFatalErrors, seedSession } from './helpers.js';
import { PT_QUIET } from './paycalc-helpers.js';
import { readFile } from 'node:fs/promises';

// ── Back up your pay data (v19.16) ────────────────────────────────────────────
// A restore REPLACES a member's entire pay history, and the rules that decide whether to do it are
// unit-tested in paycalc-transfer.test.mjs. What no unit test can prove is the WIRING — that the
// paste box reaches the ladder, that the confirmation actually gates the write, and that the data
// survives the reload. That gap is exactly the one the v19.13 tips crash fell through (a static
// suite passed; a human pressing the button found it), so the destructive path gets a real browser.

test('paycalc: the Settings deep link lands on the backup card OPEN', async ({ page }) => {
    // A bare fragment jump would scroll to a collapsed header, which reads as a dead link.
    // The viewport is pinned to a phone DELIBERATELY: the landing-position assertion below only
    // reproduces the drift on a single-column layout. On desktop the card sits in the col-3 sidebar
    // and never moves, so the project's default viewport made this test pass either way.
    await page.setViewportSize({ width: 390, height: 844 });
    await seedSession(page);
    await page.addInitScript(PT_QUIET);
    await page.goto('/paycalc.html#payTransferCard');
    await expect(page.locator('#payTransferBody')).toHaveClass(/open/);
    await expect(page.locator('#ptSummary')).not.toBeEmpty();

    // Landing POSITION, not just state. One scrollIntoView is not enough — the calculator keeps
    // laying out afterwards and the card drifts back down (measured at y=681 of an 844px viewport,
    // with 605px of scroll still available, i.e. the page had not bottomed out). Anything below
    // roughly a third of the viewport means the correction has regressed.
    await page.waitForTimeout(900);
    // VISIBLE before positioned (Sep 2026). A hidden card has no box, and `box.y` on null failed this
    // test with a TypeError — a failure by accident, which protects by accident. Measured in a
    // throwaway prototype that hid the card behind a disclosure control: the body still gained
    // `.open`, every scroll correction ran as a no-op against `display: none`, and the member landed
    // at the top of the page with nothing to explain why. This line makes that regression fail as
    // what it is. (The prototype was not adopted — DECISIONS.md, "More pay tools" — but the weakness
    // it found in this test was real.)
    const card = page.locator('#payTransferCard');
    await expect(card, 'the backup card must be visible before its landing position means anything').toBeVisible();
    const box = await card.boundingBox();
    const vh = page.viewportSize().height;
    expect(box.y, `card landed at y=${Math.round(box.y)} of ${vh}`).toBeLessThan(vh / 3);
});

// ── The Year to Date card's deep link (v24.86) ───────────────────────────────────────────────────
// The Calendar's Year to Date notice that first linked here was retired on 22 Nov 2026 with the October
// timetable notice; the link it used, paycalc.html#payslipCard, is still the Pay page's own route to the
// card (the premium notice's too). Clock pinned inside the Pay page's own Year to Date notice's life
// (to ~26 Nov), so it does not silently retire and leave this proving nothing.
const YTD_NOTICE_DAY = new Date('2026-10-22T09:00:00Z');

test('paycalc: the Year to Date card\'s deep link lands on that card OPEN, and the Pay notice stays out of its way', async ({ page }) => {
    // Phone width for the same reason as the backup card's deep link above: on one column the card
    // sits far down a page that keeps growing after load, which is what the correction is for.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.clock.setFixedTime(YTD_NOTICE_DAY);
    await seedSession(page);
    await page.addInitScript(() => {
        localStorage.setItem('myb_pc_ns_migrated', '1');
        // The Pay page's own Year to Date notice, UNSEEN — on a clean device it opens (the test
        // above proves it). Arriving by this link must keep it off the card the link opened.
        localStorage.removeItem('myb_pc_ytd_notice_2_shown');
    });
    await page.goto('/paycalc.html#payslipCard');
    await expect(page.locator('#payslipCardBody')).toHaveClass(/open/);

    await page.waitForTimeout(900);
    const card = page.locator('#payslipCard');
    await expect(card, 'the card must be visible before its landing position means anything').toBeVisible();
    const box = await card.boundingBox();
    const vh = page.viewportSize().height;
    expect(box.y, `card landed at y=${Math.round(box.y)} of ${vh}`).toBeLessThan(vh / 3);

    // Never opened over the two boxes it asks the member to fill — and NOT flagged seen (App Notices
    // review, 24 Nov 2026): the Calendar notice that made this link a delivery of the same message was
    // retired, so a link that opened a card is any other link now, and the notice waits for a load
    // without one.
    await page.waitForTimeout(1500);
    await expect(page.locator('#noticeYtdLightbox.visible')).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('myb_pc_ytd_notice_2_shown'))).toBeNull();
    await page.goto('/paycalc.html');
    await expect(page.locator('#noticeYtdLightbox.visible'), 'a load with no link gets it').toBeVisible();
});

test('paycalc: a long confirm dialog keeps its own buttons on screen', async ({ page }) => {
    // A SHARED-OVERLAY rule, exercised here because this is where a genuinely long message occurs.
    // `.dialog-lb-content` had no height cap while every message was two lines; the restore
    // confirmation now itemises both sides of a replace, and measured at 360x640 with a full
    // namespace it reached 616px of 640 — one more tax year from putting Cancel and Replace off
    // the bottom with no way to scroll to them. A modal nobody can dismiss is the worst failure a
    // modal has. No static test can see this: it is a rendered height against a viewport.
    await page.setViewportSize({ width: 360, height: 640 });
    await seedSession(page, 'G. Miller');
    await page.addInitScript(PT_QUIET);
    await page.addInitScript(() => {
        localStorage.setItem('myb_pc_gmiller_p16', '{"satH":7}');
        localStorage.setItem('myb_pc_gmiller_bp_state_2025_26', '{}');
        localStorage.setItem('myb_pc_gmiller_pension_timeline', '[]');
        localStorage.setItem('myb_pc_gmiller_actuals', '{}');
        localStorage.setItem('myb_pc_gmiller_snap_16', '{}');
    });
    await page.goto('/paycalc.html#payTransferCard');
    await expect(page.locator('#payTransferBody')).toHaveClass(/open/);

    // A deliberately maximal backup: many payslips, four tax years, and damage to report.
    await page.locator('#ptPaste').fill(JSON.stringify({
        format: 'myb-paycalc-backup', version: 1, member: 'G. Miller', slug: 'gmiller',
        data: Object.fromEntries([
            ...Array.from({ length: 13 }, (_, i) => [`myb_pc_gmiller_p${20 + i}`, '{"satH":1']),
            ['myb_pc_gmiller_setup_2022_23', '1'], ['myb_pc_gmiller_bp_state_2023_24', '{}'],
            ['myb_pc_gmiller_ytd_src_2024_25', '5'], ['myb_pc_gmiller_hpp_actual_2026_27', '1'],
        ]),
    }));
    await page.locator('#ptPasteGo').click();
    const confirm = page.locator('.dialog-btn-confirm');
    await expect(confirm).toBeVisible();
    const btn = await confirm.boundingBox();
    expect(btn.y + btn.height, `confirm button bottom at ${Math.round(btn.y + btn.height)} of 640`)
        .toBeLessThanOrEqual(640);

    // The consequence and the damage warning must be READ, not scrolled to. Detail may sit below
    // the fold; a consequence may not, so both lead the message.
    const msg = page.locator('.dialog-message');
    const top = (await msg.innerText()).slice(0, 260);
    expect(top, top).toMatch(/Restoring replaces what is here and can’t be undone/);
    expect(top, top).toMatch(/choose Cancel and use Download backup/);   // the way out, named (R5-10)
    expect(top, top).toMatch(/damaged and will not open/);
    await expect(page.locator('.dialog-btn-cancel'), 'the button the message names').toHaveText('Cancel');
    await expect(confirm).toHaveText('Replace my pay data');

    await page.locator('.dialog-btn-cancel').click();
    await expect(page.locator('#ptStatus')).toContainText('Nothing was changed');
});

test('paycalc: the card itemises what is here, and the dialog names BOTH sides', async ({ page }) => {
    // The inventory RULES are unit-tested in paycalc-inventory.test.mjs. What only a browser can
    // show is that the card asks them at all, and that the destructive dialog states what is being
    // destroyed — which until v22.14 it did not: it named one count about the incoming file and
    // nothing whatsoever about the pay history it was replacing.
    await seedSession(page, 'G. Miller');
    await page.addInitScript(PT_QUIET);
    await page.addInitScript(() => {
        localStorage.setItem('myb_pc_gmiller_p16', '{"satH":7,"satM":30}');
        localStorage.setItem('myb_pc_gmiller_bp_state_2025_26', '{"inc":true}');
        localStorage.setItem('myb_pc_gmiller_pension_timeline', '[]');
    });
    await page.goto('/paycalc.html#payTransferCard');
    await expect(page.locator('#payTransferBody')).toHaveClass(/open/);

    // The card no longer folds four features into "plus your settings".
    const items = page.locator('#ptInventory li');
    await expect(items).not.toHaveCount(0);
    const listed = (await items.allTextContents()).join(' | ');
    expect(listed, listed).toMatch(/1 payslip of entered figures/);
    // The app confirms the CURRENT tax year during boot, so the device legitimately holds two
    // years here — which is itself the fix working: `setup_<year>` was one of the four kinds the
    // old count could not see at all.
    expect(listed, listed).toMatch(/Tax years? .*2025\/26/);
    expect(listed, listed).toMatch(/Back pay/);
    expect(listed, listed).toMatch(/Pension/);

    // A backup of a DIFFERENT shape — one payslip, a different tax year — so the two halves of the
    // dialog cannot both be satisfied by the same string.
    await page.locator('#ptPaste').fill(JSON.stringify({
        format: 'myb-paycalc-backup', version: 1, member: 'G. Miller', slug: 'gmiller',
        data: {
            'myb_pc_gmiller_p20': '{"satH":1,"satM":0}',
            'myb_pc_gmiller_p21': '{"satH":2,"satM":0}',
            'myb_pc_gmiller_hpp_actual_2026_27': '1843.01',
        },
    }));
    await page.locator('#ptPasteGo').click();
    const msg = page.locator('.dialog-message');
    await expect(msg).toContainText('The backup holds:');
    await expect(msg).toContainText('2 payslips of entered figures');
    // "Tax year 2026/27" — singular, and only true of the backup half: the incoming file's one
    // year is revealed solely by an `hpp_actual` key, which the pre-v22.14 count could not see.
    await expect(msg).toContainText('Tax year 2026/27');
    await expect(msg).toContainText('This device currently holds:');
    await expect(msg).toContainText('2025/26');   // present only on the device side

    // Cancel: nothing written, and the card says so.
    await page.locator('.dialog-btn-cancel').click();
    await expect(page.locator('#ptStatus')).toContainText('Nothing was changed');
    expect(await page.evaluate(() => localStorage.getItem('myb_pc_gmiller_p20'))).toBeNull();
});

test('paycalc: backup → restore round trip survives the reload', async ({ page }) => {
    await seedSession(page, 'G. Miller');
    // The payload key is written AFTER load, never in an init script: addInitScript re-runs on the
    // post-restore reload, so a seeded value reappears on its own and the test passes even with the
    // restore's write deleted. (Confirmed the hard way — the first version of this test did exactly
    // that.) Written here, the restore is the only thing that can put the figure back.
    await page.addInitScript(PT_QUIET);
    await page.goto('/paycalc.html#payTransferCard');
    await expect(page.locator('#payTransferBody')).toHaveClass(/open/);
    await page.evaluate(() => localStorage.setItem('myb_pc_gmiller_p16', '{"satH":7,"satM":30}'));

    const backup = await page.evaluate(async () => {
        const m = await import('/paycalc-transfer.js');
        const mig = await import('/paycalc-migrations.js');
        const keys = m.selectBackupKeys(Object.keys(localStorage), mig.pcPrefix());
        const entries = Object.fromEntries(keys.map(k => [k, localStorage.getItem(k)]));
        return JSON.stringify(m.buildBackup({
            entries, member: 'G. Miller', slug: 'gmiller',
            appVersion: 'x', exportedAt: '2026-07-29T00:00:00.000Z', prefix: mig.pcPrefix(),
        }));
    });
    expect(backup).toContain('myb_pc_gmiller_p16');

    await page.evaluate(() => localStorage.setItem('myb_pc_gmiller_p16', '{"satH":0,"satM":0}'));
    await page.locator('#ptPaste').fill(backup);
    // The card reloads the page 800ms after a successful restore. WAIT FOR THAT NAVIGATION, never a
    // fixed sleep: the old `waitForTimeout(1200)` raced it — on a slow CI runner the reload was
    // still in flight when the sleep ended, so the localStorage read below landed mid-navigation
    // and died with "Execution context was destroyed". It was the suite's most frequent WebKit
    // flake (three sightings), and the flake was REAL information about the test, not the engine:
    // a sleep is a bet about someone else's timer. The listener is armed before the click that can
    // trigger the reload, so it cannot miss a fast one either.
    const reloaded = page.waitForEvent('load');
    await page.locator('#ptPasteGo').click();
    await page.locator('.dialog-btn-confirm').click();      // "Replace my pay data" — the write is gated on this
    await expect(page.locator('#ptStatus')).toContainText('Restored 1 payslip. Reloading…');
    await reloaded;
    expect(await page.evaluate(() => localStorage.getItem('myb_pc_gmiller_p16')))
        .toBe('{"satH":7,"satM":30}');
});

// A backup can hold no payslips at all — settings and Year to Date figures only — and the card said
// "Restored 0 payslips", which reads as a restore that did nothing (17 Nov 2026).
test('paycalc: a backup with no payslips says it was restored, not "Restored 0 payslips"', async ({ page }) => {
    await seedSession(page);
    await page.addInitScript(PT_QUIET);
    await page.goto('/paycalc.html#payTransferCard');
    await expect(page.locator('#payTransferBody')).toHaveClass(/open/);
    await page.evaluate(() => localStorage.setItem('myb_pc_gmiller_code', 'K100'));   // something for it to replace
    await page.locator('#ptPaste').fill(JSON.stringify({
        format: 'myb-paycalc-backup', version: 1, member: 'G. Miller', slug: 'gmiller',
        data: { myb_pc_gmiller_code: '1257L' },
    }));
    const reloaded = page.waitForEvent('load');
    await page.locator('#ptPasteGo').click();
    await page.locator('.dialog-btn-confirm').click();      // "Replace my pay data" — the write is gated on this
    await expect(page.locator('#ptStatus')).toHaveText('Restored your backup — it held no payslips. Reloading…');
    await reloaded;
    expect(await page.evaluate(() => localStorage.getItem('myb_pc_gmiller_code')), 'premise: it was restored').toBe('1257L');
});

// A PAYSLIP SAVED IN ANOTHER TAB WHILE "Replace your pay data?" IS OPEN (external review of v26.55). The list of
// what was here was taken before the question, so the replace wrote the backup over it, left the new payslip beside
// it — a merge — and said "Restored". Now the data is read again before writing: changed, nothing is written and the
// question comes back with what is here now. The new payslip is never deleted unseen.
test('paycalc: a payslip saved elsewhere while the replace question is open is neither merged nor lost', async ({ page }) => {
    await seedSession(page);
    await page.addInitScript(PT_QUIET);
    await page.goto('/paycalc.html#payTransferCard');
    await expect(page.locator('#payTransferBody')).toHaveClass(/open/);
    await page.evaluate(() => localStorage.setItem('myb_pc_gmiller_code', 'K100'));   // something for it to replace
    await page.locator('#ptPaste').fill(JSON.stringify({
        format: 'myb-paycalc-backup', version: 1, member: 'G. Miller', slug: 'gmiller',
        data: { myb_pc_gmiller_code: '1257L' },
    }));
    await page.locator('#ptPasteGo').click();
    await expect(page.locator('.dialog-btn-confirm')).toHaveText('Replace my pay data');
    // Another tab saves a payslip while the question waits.
    await page.evaluate(() => localStorage.setItem('myb_pc_gmiller_p20', '{"satH":8,"satM":0}'));
    await page.locator('.dialog-btn-confirm').click();
    await expect(page.locator('#ptStatus')).toContainText('changed while that question was open, so nothing was changed');
    expect(await page.evaluate(() => localStorage.getItem('myb_pc_gmiller_code')), 'nothing was written').toBe('K100');
    // …and it asks again, now naming the payslip that arrived.
    // The first dialog is still in the page for its closing fade, so this is the newest one.
    const again = page.locator('.dialog-overlay').last();
    await expect(again.locator('.dialog-btn-confirm')).toHaveText('Replace my pay data');
    await expect(again.locator('.dialog-message')).toContainText(/payslip/i);
    await again.locator('.dialog-btn-cancel').click();
    expect(await page.evaluate(() => localStorage.getItem('myb_pc_gmiller_p20')), 'the new payslip is still here').toBe('{"satH":8,"satM":0}');
});

test("paycalc: another member's backup is refused and writes nothing", async ({ page }) => {
    // Option A. Staff share devices — which is precisely why the per-member namespacing exists.
    await seedSession(page, 'G. Miller');
    await page.addInitScript(PT_QUIET);
    await page.goto('/paycalc.html#payTransferCard');
    await page.locator('#ptPaste').fill(JSON.stringify({
        format: 'myb-paycalc-backup', version: 1, member: 'S. Silva', slug: 'ssilva',
        data: { myb_pc_ssilva_p16: '{}' },
    }));
    await page.locator('#ptPasteGo').click();
    await expect(page.locator('#ptStatus')).toContainText('belongs to S. Silva');
    expect(await page.evaluate(() => localStorage.getItem('myb_pc_ssilva_p16'))).toBeNull();
});

test('paycalc: an unidentifiable member cannot back up or restore', async ({ page }) => {
    // A session name that is no longer on the roster (a leaver, a rename). getLoggedMember()
    // returns null, so the per-member namespace never activates and pcPrefix() falls back to the
    // bare `myb_pc_` — which spans EVERY member on a shared device. Before v19.17 the paste box was
    // left enabled in this state, and one paste deleted two people's pay history and wrote the
    // payload unnamespaced. The session guard does not catch this: the session is valid, it is the
    // member lookup that fails.
    //
    // SINCE THE 72-HOUR REVIEW THE WHOLE CALCULATOR IS WITHHELD, not just this card: the same null
    // member also priced every figure at CEA rates in the bare shared namespace. So the page refuses
    // with the unsupported card before the namespace is ever activated — and the transfer card's own
    // fail-closed rule (validateBackup refusing an empty slug) stays, unit-tested, as the second lock.
    await seedSession(page, 'Z. NotOnRoster');
    await page.addInitScript(PT_QUIET);
    await page.goto('/paycalc.html#payTransferCard');
    await expect(page.locator('#unsupportedGradeBanner')).toBeVisible();
    await expect(page.locator('#unsupportedGradeBanner')).toContainText('current roster');
    // Told what has happened, and not what a page it cannot use does: the "What it does" box goes
    // whole — its heading and guide link with it (paycalc-role-card.js → paintRoleCard).
    await expect(page.locator('#unsupportedGradeAbout')).toBeHidden();
    await expect(page.locator('.pc-side'), 'the backup card must not be reachable').toBeHidden();
    await expect(page.locator('.pc-work'), 'and no figure is shown').toBeHidden();
    expect(await page.evaluate(() => Object.keys(localStorage).filter(k => /^myb_pc_p\d+$/.test(k))),
        'nothing is written into the bare shared namespace').toEqual([]);
});

test('paycalc: a restore onto storage that refuses writes changes nothing', async ({ page }) => {
    // `lsSet` SWALLOWS a storage error (ls.js, for iOS private mode), so a write that did nothing is
    // indistinguishable from one that worked — a try/catch around it is dead code. Before v19.17 the
    // card wiped first and wrote second, so a device that had stopped accepting writes lost the
    // member's entire pay history and was told "Restored". The write now happens FIRST, is verified
    // by reading back, and the surplus is only removed once that passes.
    await seedSession(page, 'G. Miller');
    await page.addInitScript(PT_QUIET);
    await page.goto('/paycalc.html#payTransferCard');
    await expect(page.locator('#payTransferBody')).toHaveClass(/open/);
    await page.evaluate(() => localStorage.setItem('myb_pc_gmiller_p16', '{"satH":7,"satM":30}'));

    const backup = await page.evaluate(async () => {
        const m = await import('/paycalc-transfer.js');
        const mig = await import('/paycalc-migrations.js');
        const keys = m.selectBackupKeys(Object.keys(localStorage), mig.pcPrefix());
        const entries = Object.fromEntries(keys.map(k => [k, localStorage.getItem(k)]));
        return JSON.stringify(m.buildBackup({
            entries, member: 'G. Miller', slug: 'gmiller',
            appVersion: 'x', exportedAt: '2026-07-29T00:00:00.000Z', prefix: mig.pcPrefix(),
        }));
    });

    // The on-device data must DIFFER from the backup, or reading back matches trivially and this
    // proves nothing. Plus a key the backup does not contain, to prove no surplus delete happened.
    await page.evaluate(() => {
        localStorage.setItem('myb_pc_gmiller_p16', 'STALE-VALUE');
        localStorage.setItem('myb_pc_gmiller_surplus', 'SHOULD-SURVIVE');
        Object.getPrototypeOf(localStorage).setItem = function () {
            throw new DOMException('quota', 'QuotaExceededError');   // as a full device does
        };
    });

    await page.locator('#ptPaste').fill(backup);
    await page.locator('#ptPasteGo').click();
    await page.locator('.dialog-btn-confirm').click();
    await expect(page.locator('#ptStatus')).toContainText('nothing was changed');
    expect(await page.evaluate(() => localStorage.getItem('myb_pc_gmiller_p16'))).toBe('STALE-VALUE');
    expect(await page.evaluate(() => localStorage.getItem('myb_pc_gmiller_surplus'))).toBe('SHOULD-SURVIVE');
});

// ── A READ THAT FAILS IS NEVER "NOTHING THERE" (Nov 2026) ─────────────────────────────────────────
// `lsGet` answers null for a refused read, so a backup of two payslips whose second read was refused
// downloaded the first alone, counted one payslip and said nothing; and a restore that could not read
// one of the originals it was about to replace treated it as absent, so its rollback DELETED it and
// the card said "nothing was changed". The storage is made to refuse on demand here, by key.

/** Make the browser's own `getItem` throw for the keys in `window.__unreadable`, and for the Nth read
 *  of `window.__failNth.key` counted from when it is set. @param {import('@playwright/test').Page} page */
const refuseReads = (page) => page.evaluate(() => {
    const w = /** @type {any} */ (window);
    const proto = Object.getPrototypeOf(localStorage);
    const real = proto.getItem;
    w.__unreadable = new Set();
    w.__failNth = null;
    proto.getItem = function (/** @type {string} */ k) {
        if (w.__unreadable.has(k)) throw new DOMException('read refused', 'UnknownError');
        if (w.__failNth && w.__failNth.key === k && ++w.__failNth.seen === w.__failNth.n) {
            throw new DOMException('read refused', 'UnknownError');
        }
        return real.call(this, k);
    };
});

/** A backup of G. Miller's figures, written by hand. @param {Record<string,string>} data */
const handBackup = (data) => JSON.stringify({ format: 'myb-paycalc-backup', version: 1, member: 'G. Miller', slug: 'gmiller', data });

test('paycalc: a payslip that cannot be read stops the backup, and the card names it', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await seedSession(page, 'G. Miller');
    await page.addInitScript(PT_QUIET);
    await page.addInitScript(() => {
        localStorage.setItem('myb_pc_gmiller_p52', '{"satH":7,"satM":30}');   // paid 5 June 2026
        localStorage.setItem('myb_pc_gmiller_p53', '{"satH":8,"satM":0}');    // paid 3 July 2026
    });
    await fakeShareDevice(page, ANDROID_UA);         // the download path on every engine
    await page.goto('/paycalc.html#payTransferCard');
    await expect(page.locator('#payTransferBody')).toHaveClass(/open/);
    let downloads = 0;
    page.on('download', () => { downloads++; });
    await page.evaluate(() => {
        const w = /** @type {any} */ (window);
        w.__copied = [];
        Object.defineProperty(navigator, 'clipboard', { configurable: true,
            value: { writeText: async (/** @type {string} */ t) => { w.__copied.push(t); } } });
    });
    await refuseReads(page);
    await page.evaluate(() => /** @type {any} */ (window).__unreadable.add('myb_pc_gmiller_p53'));

    const status = page.locator('#ptSaveStatus');
    await page.locator('#ptDownload').click();
    await expect(status).toHaveText("The payslip paid 3 July 2026 (P16) couldn't be read on this device, so a backup made "
        + 'now would be missing it. Nothing was saved. Tap Download backup to try again.');
    await expect(status).toHaveClass(/pt-status--warn/);
    await page.locator('#ptCopy').click();
    await expect(status).toContainText('Nothing was copied. Tap Copy as text to try again.');
    expect(await page.evaluate(() => /** @type {any} */ (window).__copied.length), 'no partial copy reaches the clipboard').toBe(0);
    expect(downloads, 'no partial file is offered').toBe(0);

    // The retry it offers works once storage answers, and carries both payslips.
    await page.evaluate(() => /** @type {any} */ (window).__unreadable.clear());
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#ptDownload').click()]);
    const blob = JSON.parse(await readFile(/** @type {string} */ (await download.path()), 'utf8'));
    expect(Object.keys(blob.data).filter(k => /_p\d+$/.test(k)).sort()).toEqual(['myb_pc_gmiller_p52', 'myb_pc_gmiller_p53']);
    expect(blob.data.myb_pc_gmiller_p53).toBe('{"satH":8,"satM":0}');
    expect(blob.counts.periods).toBe(2);
    expect(errors).toHaveLength(0);
});

test('paycalc: a restore that cannot read an original it would replace writes nothing and says so truthfully', async ({ page }) => {
    await seedSession(page, 'G. Miller');
    await page.addInitScript(PT_QUIET);
    await page.goto('/paycalc.html#payTransferCard');
    await expect(page.locator('#payTransferBody')).toHaveClass(/open/);
    await page.evaluate(() => {
        localStorage.setItem('myb_pc_gmiller_p52', 'ORIG-52');
        localStorage.setItem('myb_pc_gmiller_p53', 'ORIG-53');
    });
    await refuseReads(page);
    await page.locator('#ptPaste').fill(handBackup({ myb_pc_gmiller_p52: 'NEW-52', myb_pc_gmiller_p53: 'NEW-53' }));
    await page.locator('#ptPasteGo').click();
    // The original is unreadable ONCE, after the question: the card's own check reads it first, and the
    // restore's read of what it is about to replace is the one refused. Then a write is refused too.
    await page.evaluate(() => {
        const w = /** @type {any} */ (window);
        w.__failNth = { key: 'myb_pc_gmiller_p52', n: 2, seen: 0 };
        const proto = Object.getPrototypeOf(localStorage);
        const realSet = proto.setItem;
        proto.setItem = function (/** @type {string} */ k, /** @type {string} */ v) {
            if (k === 'myb_pc_gmiller_p53') throw new DOMException('quota', 'QuotaExceededError');
            return realSet.call(this, k, v);
        };
    });
    await page.locator('.dialog-btn-confirm').click();
    await expect(page.locator('#ptStatus')).toHaveText("This device couldn't read the pay data already saved on it, so "
        + 'nothing was changed. Your backup is still fine — try the restore again.');
    expect(await page.evaluate(() => localStorage.getItem('myb_pc_gmiller_p52')), 'the original is still here').toBe('ORIG-52');
    expect(await page.evaluate(() => localStorage.getItem('myb_pc_gmiller_p53'))).toBe('ORIG-53');
});

test('paycalc: a restore over pay data it cannot read or list does not even ask, and writes nothing', async ({ page }) => {
    await seedSession(page, 'G. Miller');
    await page.addInitScript(PT_QUIET);
    await page.goto('/paycalc.html#payTransferCard');
    await expect(page.locator('#payTransferBody')).toHaveClass(/open/);
    await page.evaluate(() => localStorage.setItem('myb_pc_gmiller_p52', 'ORIG-52'));
    await refuseReads(page);
    const unread = "This device couldn't read the pay data already saved on it, so nothing was changed. "
        + 'Your backup is still fine — try the restore again.';
    // An unreadable value…
    await page.evaluate(() => /** @type {any} */ (window).__unreadable.add('myb_pc_gmiller_p52'));
    await page.locator('#ptPaste').fill(handBackup({ myb_pc_gmiller_p52: 'NEW-52' }));
    await page.locator('#ptPasteGo').click();
    await expect(page.locator('#ptStatus')).toHaveText(unread);
    await expect(page.locator('.dialog-btn-confirm'), 'no question over data it could not read').toHaveCount(0);
    // …and a list of keys the browser will not give.
    await page.evaluate(() => {
        /** @type {any} */ (window).__unreadable.clear();
        Object.getPrototypeOf(localStorage).key = function () { throw new DOMException('list refused', 'UnknownError'); };
    });
    await page.locator('#ptStatus').evaluate(el => { el.textContent = ''; });
    await page.locator('#ptPasteGo').click();
    await expect(page.locator('#ptStatus')).toHaveText(unread);
    await expect(page.locator('.dialog-btn-confirm')).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('myb_pc_gmiller_p52'))).toBe('ORIG-52');
});

test('paycalc: pay data that becomes unreadable while the replace question is open is not called "changed"', async ({ page }) => {
    await seedSession(page, 'G. Miller');
    await page.addInitScript(PT_QUIET);
    await page.goto('/paycalc.html#payTransferCard');
    await expect(page.locator('#payTransferBody')).toHaveClass(/open/);
    await page.evaluate(() => localStorage.setItem('myb_pc_gmiller_p52', 'ORIG-52'));
    await refuseReads(page);
    await page.locator('#ptPaste').fill(handBackup({ myb_pc_gmiller_p52: 'NEW-52' }));
    await page.locator('#ptPasteGo').click();
    await expect(page.locator('.dialog-btn-confirm')).toBeVisible();
    // Every line the status shows from here is recorded: a passing "changed while that question was
    // open" would be a claim about the member's data that nobody could have checked.
    await page.evaluate(() => {
        const w = /** @type {any} */ (window);
        w.__said = [];
        new MutationObserver(recs => { for (const r of recs) for (const n of r.addedNodes) w.__said.push(n.textContent); })
            .observe(/** @type {Element} */ (document.getElementById('ptStatus')), { childList: true });
        w.__unreadable.add('myb_pc_gmiller_p52');
    });
    await page.locator('.dialog-btn-confirm').click();
    await expect(page.locator('#ptStatus')).toHaveText("This device couldn't read the pay data already saved on it, so "
        + 'nothing was changed. Your backup is still fine — try the restore again.');
    expect(await page.evaluate(() => /** @type {any} */ (window).__said)).toEqual([expect.stringContaining("couldn't read")]);
    await page.evaluate(() => /** @type {any} */ (window).__unreadable.clear());
    expect(await page.evaluate(() => localStorage.getItem('myb_pc_gmiller_p52'))).toBe('ORIG-52');
});

test('paycalc: a restore whose rollback cannot put everything back says the device may be part-restored', async ({ page }) => {
    await seedSession(page, 'G. Miller');
    await page.addInitScript(PT_QUIET);
    await page.goto('/paycalc.html#payTransferCard');
    await expect(page.locator('#payTransferBody')).toHaveClass(/open/);
    await page.evaluate(() => localStorage.setItem('myb_pc_gmiller_p52', 'ORIG-52'));
    await page.locator('#ptPaste').fill(handBackup({ myb_pc_gmiller_p52: 'NEW-52', myb_pc_gmiller_p53: 'NEW-53' }));
    await page.locator('#ptPasteGo').click();
    // p53's write is refused, and once p52 holds the backup's figure, putting the original back is refused too.
    await page.evaluate(() => {
        const proto = Object.getPrototypeOf(localStorage);
        const realSet = proto.setItem;
        let p52Written = false;
        proto.setItem = function (/** @type {string} */ k, /** @type {string} */ v) {
            if (k === 'myb_pc_gmiller_p53' || (k === 'myb_pc_gmiller_p52' && p52Written)) throw new DOMException('quota', 'QuotaExceededError');
            if (k === 'myb_pc_gmiller_p52') p52Written = true;
            return realSet.call(this, k, v);
        };
    });
    await page.locator('.dialog-btn-confirm').click();
    const status = page.locator('#ptStatus');
    await expect(status).toContainText('so some of your pay data here may now be from the backup and some from before');
    await expect(status).toContainText('restore from the same file again');
    await expect(status).not.toContainText('nothing was changed');
    await expect(status).toHaveClass(/pt-status--warn/);
    expect(await page.evaluate(() => localStorage.getItem('myb_pc_gmiller_p52')), 'premise: genuinely part-restored').toBe('NEW-52');
});

// "Download backup" said "Saved as …" the instant the tap landed — before iOS had saved anything —
// and a blob download in the Home Screen app may open a preview rather than save. On an iPhone it now
// opens the share sheet (Save to Files, in a tab and in the installed app), IN the tap, and reports
// how the sheet ended; everywhere else it stays a download, worded as what to expect. The platform is
// set per test rather than taken from the project, so both branches run on both engines.
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
/** A device that CAN share files, recording each share and ending it as `__shareEnds` says. */
const fakeShareDevice = (/** @type {import('@playwright/test').Page} */ page, /** @type {string} */ ua) => page.addInitScript((agent) => {
    const w = /** @type {any} */ (window);
    Object.defineProperty(navigator, 'userAgent', { configurable: true, get: () => agent });
    Object.defineProperty(navigator, 'platform', { configurable: true, get: () => (agent.includes('iPhone') ? 'iPhone' : 'Linux armv8l') });
    w.__shares = [];
    w.__shareEnds = 'resolve';
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: (/** @type {any} */ d) => !!d?.files?.length });
    Object.defineProperty(navigator, 'share', { configurable: true, value: (/** @type {any} */ d) => {
        w.__shares.push(d.files.map((/** @type {File} */ f) => f.name));
        return w.__shareEnds === 'abort' ? Promise.reject(new DOMException('cancelled', 'AbortError')) : Promise.resolve();
    } });
    // IN THE TAP: a listener on the document runs AFTER the button's own handler, in the same
    // dispatch. A share recorded by then was started inside the tap; one deferred to a later task —
    // an awaited file read, a timer — was not, and iOS refuses it for want of a gesture. (A microtask
    // also runs before this listener, because the browser checkpoints them between listeners, so this
    // cannot tell one from a synchronous call; the handler makes the call synchronously anyway.)
    document.addEventListener('click', (e) => {
        if (/** @type {Element} */ (e.target)?.id === 'ptDownload') w.__sharedInTap = w.__shares.length;
    });
}, ua);

test('paycalc: on an iPhone, Download backup opens the share sheet in the tap and says how it ended', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await seedSession(page);
    await page.addInitScript(PT_QUIET);
    await page.addInitScript(() => localStorage.setItem('myb_pc_gmiller_p16', '{"satH":7,"satM":30}'));
    await fakeShareDevice(page, IPHONE_UA);
    let downloads = 0;
    page.on('download', () => { downloads++; });
    await page.goto('/paycalc.html#payTransferCard');
    await expect(page.locator('#payTransferBody')).toHaveClass(/open/);
    const status = page.locator('#ptSaveStatus');

    await page.locator('#ptDownload').click();
    await expect(status).toContainText('If you chose Save to Files, look for');
    await expect(status).toContainText('in the Files app');
    expect(await page.evaluate(() => /** @type {any} */ (window).__sharedInTap),
        'navigator.share must be called inside the tap, or iOS refuses it for want of a gesture').toBe(1);
    expect(await page.evaluate(() => /** @type {any} */ (window).__shares[0][0])).toMatch(/^myb-pay-backup-gmiller-\d{4}-\d{2}-\d{2}\.json$/);

    // Closing the sheet saves nothing, and the card must not say otherwise.
    await page.evaluate(() => { /** @type {any} */ (window).__shareEnds = 'abort'; });
    await page.locator('#ptDownload').click();
    await expect(status).toContainText('Not saved');
    await expect(status).toHaveClass(/pt-status--warn/);
    expect(downloads, 'an iPhone that can share files gets the share sheet, never a blob download').toBe(0);
    expect(errors).toHaveLength(0);
});

test('paycalc: away from an iPhone, Download backup stays a download and says what to expect', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await seedSession(page);
    await page.addInitScript(PT_QUIET);
    await page.addInitScript(() => localStorage.setItem('myb_pc_gmiller_p16', '{"satH":7,"satM":30}'));
    // Android CAN share files too — and must still get the download it has always had.
    await fakeShareDevice(page, ANDROID_UA);
    await page.goto('/paycalc.html#payTransferCard');
    await expect(page.locator('#payTransferBody')).toHaveClass(/open/);

    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#ptDownload').click()]);
    expect(download.suggestedFilename()).toMatch(/^myb-pay-backup-gmiller-\d{4}-\d{2}-\d{2}\.json$/);
    expect(await page.evaluate(() => /** @type {any} */ (window).__shares.length), 'Android is never sent to the share sheet').toBe(0);
    const status = page.locator('#ptSaveStatus');
    await expect(status).toContainText(`If you're asked, choose Download`);
    await expect(status, 'the page cannot see a download finish, so it must not claim one').not.toContainText('Saved as');
    await expect(status, 'and it is not dressed as a confirmation either').not.toHaveClass(/pt-status--ok/);
    expect(errors).toHaveLength(0);
});

// Pay figures live in the browser that saved them, and on an iPhone that is two places: Safari and
// the Home Screen app keep separate copies, and Safari clears its own after about a week unvisited.
// So the commonest way to find the calculator EMPTY is to have had figures somewhere else — and the
// setup banner now says where to get them back. Its link must OPEN the card: a bare jump to
// #payTransferCard lands on a closed header, which reads as a dead link.
test('paycalc: an empty calculator points at Restore, and the link opens the backup card', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await seedSession(page);
    await page.addInitScript(PT_QUIET);
    await page.goto('/paycalc.html');
    const line = page.locator('#setupRestore');
    await expect(line).toBeVisible();
    // Not "on this phone": the line shows on a first visit anywhere, the station PC included.
    await expect(line).toContainText('Used the Pay Calculator before?');
    await expect(page.locator('#payTransferBody')).not.toHaveClass(/open/);
    await line.getByRole('link', { name: 'Move Your Pay Data' }).click();
    await expect(page.locator('#payTransferBody')).toHaveClass(/open/);
    await expect(page.locator('#payTransferCard')).toBeInViewport();
    // The card it lands on says why the figures were not here: the iPhone's two copies.
    await expect(page.locator('#payTransferBody')).toContainText('Safari and the Home Screen app keep separate copies');
    expect(errors).toHaveLength(0);
});

// "Saved automatically as you type" was promised whatever the browser did with the figures. Storage
// refuses in two shapes, and only one of them reaches this page:
//   · READS WORK, WRITES THROW — a full quota. The session still reads, the calculator renders, and
//     every figure typed in is gone when the page closes. That is where the promise was false.
//   · THE GETTER THROWS — Safari's "Block All Cookies". The session cannot be read either, so the
//     member meets the sign-in card, never the calculator (the second test pins that, so the
//     warning is never needed there and nobody adds a promise where it would be).
test('paycalc: a browser that will not save says so where it used to promise "Saved automatically"', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await seedSession(page);
    await page.addInitScript(PT_QUIET);
    // AFTER the seeders, so the session they wrote is there to read — then every later write throws.
    await page.addInitScript(() => {
        Object.getPrototypeOf(localStorage).setItem = function () {
            throw new DOMException('quota', 'QuotaExceededError');   // as a full device does
        };
    });
    await page.goto('/paycalc.html');
    await expect(page.locator('#periodSelect option').first()).toBeAttached();
    const header = page.locator('#hoursCard .card-header');
    await expect(header.locator('.hours-save-blocked')).toBeVisible();
    await expect(header).toContainText("This browser isn't letting the app save, so figures you enter here will be lost when you close the page.");
    await expect(header.locator('.hours-save-ok'), 'the promise it cannot keep is gone').toBeHidden();
    // Nothing is saved here, so this is an "empty calculator" — but a restore needs the same
    // writes, so it is not pointed at one.
    await expect(page.locator('#setupBanner')).toBeVisible();
    await expect(page.locator('#setupRestore')).toBeHidden();
    expect(errors).toHaveLength(0);
});

test('paycalc: with storage blocked outright, the member meets sign-in, never a calculator that cannot keep figures', async ({ page }) => {
    await seedSession(page);
    await page.addInitScript(() => {
        Object.defineProperty(window, 'localStorage', {
            configurable: true,
            get() { throw new DOMException('The operation is insecure.', 'SecurityError'); },
        });
    });
    await page.goto('/paycalc.html');
    await expect(page.locator('#loginOverlay')).toBeVisible();
    // The calculator never initialised: no session could be read, so nothing below the sign-in card
    // was built (its static markup sits under the overlay, unpopulated).
    await expect(page.locator('#periodSelect option')).toHaveCount(0);
});

test('paycalc: a browser that saves keeps its "Saved automatically" line', async ({ page }) => {
    await seedSession(page);
    await page.addInitScript(PT_QUIET);
    await page.goto('/paycalc.html');
    await expect(page.locator('#periodSelect option').first()).toBeAttached();
    await expect(page.locator('#hoursCard .hours-save-ok')).toBeVisible();
    await expect(page.locator('#hoursCard .hours-save-blocked')).toBeHidden();
});
