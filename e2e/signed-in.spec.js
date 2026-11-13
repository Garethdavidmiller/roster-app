// @ts-check
/**
 * signed-in.spec.js — the signed-in journeys, through the REAL Firebase SDK, the real security rules
 * and the real Cloud Functions (local emulators). Run with `npm run test:signed-in`.
 *
 * Every other browser lane answers Firebase with a stub (e2e/fixtures.js), and the rules are tested on
 * their own (firestore.rules.test.mjs). This file is where the two meet: each journey here can only
 * pass if the page, the SDK, the claims `setupRosterAuth` stamps and the rules all agree. What each one
 * proves that no other lane can:
 *
 *   1. first sign-in    — the surname default works, the "set your own password" screen is
 *                         compelled, its write lands, and afterwards the surname is refused.
 *   2. a day of leave   — Admin's own save is accepted by the rules, survives a reload, and the
 *                         Calendar draws it from the database.
 *   3. a colleague's day — the rules refuse it from a member's own signed-in browser, using the
 *                         app's own write builder (the same call with their own name succeeds).
 *   4. on behalf        — a manager records an absence for a colleague, and the colleague, signed in
 *                         on their own phone, sees it.
 *   5. no signal        — a change saved offline says it is waiting, then reaches the database when
 *                         the signal returns: the real SDK's queue, which a stub cannot have.
 *   6. the staff PIN    — the real `unlockCalendarViewer` exchange opens the Calendar, the viewer reads
 *                         a member's record through the rules, and opening Admin ends the PIN and
 *                         says so.
 *   7. signing out      — Back loads the page again with nobody signed in: not in the app, and not
 *                         in the SDK's own stored sign-in, which a stub does not have.
 *   8. back online      — a delete made while a save from before the signal returned is still in
 *                         this device's queue waits for it, then deletes the member's own record
 *                         and it stays deleted. The SDK's write stream is held to keep that
 *                         second open; this is the race v25.95 closed, and the false "someone else
 *                         has changed this" v25.96 closed, neither of which a stub can order. The
 *                         same reload proves the draft kept mid-save is not offered back once its
 *                         save is in the queue (v25.97).
 *   9. Links, back online — the designer's own account: a change to a design saved with no signal
 *                         is still in this device's queue when the design is renamed, so the
 *                         rename waits for it, and the queued save cannot then land on top and put
 *                         the old name back. Links store rule 5 (v25.96), on the real SDK and the
 *                         real `linkDesigns` rules. With the wait removed, that is exactly what
 *                         happened here (measured 13 November 2026).
 *
 * What journey 7 does NOT reach is the back/forward cache, a browser restoring the page exactly as
 * it was left. Playwright launches Chrome with that cache turned off, and WebKit reloaded here too
 * (measured 11 November 2026: deleting page-session.js's guard for it left journey 7 green on both).
 * That guard's tests send the restore event themselves: page-session.test.mjs, e2e/auth.spec.js.
 *
 * Nothing here names a member or a date. The members come from the server's own roster file and
 * role lists; the days are found from the base roster, ahead of today — so a leaver or a new rota
 * changes which person and which day, never whether the journey runs.
 */
import { readFileSync } from 'node:fs';
import { test, expect, expectNothingLeftForGoogle, wireToEmulators } from './signed-in-fixtures.js';
import { resetDatabase, readCollection, seedDocument, EMULATOR } from './signed-in-env.mjs';
import { resetPasswords } from './signed-in-setup.mjs';
import { signInThroughOverlay, enterPin, sheetAction, clickDialogConfirm, activeDesignName } from './helpers.js';
import { teamMembers, getBaseShift, isBankHoliday, CONFIG } from '../roster-data.js';
import { manualOverrideId } from '../override-id.js';

const roster = JSON.parse(readFileSync(new URL('../functions/roster-members.json', import.meta.url), 'utf8'));
const withARole = new Set(Object.values(roster.roles).flat());
const plain = roster.cea.filter((/** @type {string} */ n) => !withARole.has(n));
const MEMBER = plain[0];
const COLLEAGUE = plain[1];
const MANAGER = roster.roles.manager[0];
/** Whoever the server's role list makes a Links designer: the claim Links saves through. */
const DESIGNER = roster.roles.designer[0];
/** The password each journey's member chooses on the real "set your own password" screen. */
const OWN_PASSWORD = 'signed-in lane 7';
/**
 * Every one-time notice's "seen" key, read from calendar-notices.js where each notice declares it
 * (`DONE_KEY`), so a new notice is quietened here without anybody remembering to. The notices are
 * not what this lane tests, and a real one would sit over the page the journey is about.
 */
const NOTICE_KEYS = [...readFileSync(new URL('../calendar-notices.js', import.meta.url), 'utf8')
    .matchAll(/\bDONE_KEY\s*=\s*'([^']+)'/g)].map((m) => m[1]);
/**
 * What the sign-in card says when opening a page ended the staff PIN, read from login-overlay.js where
 * it is declared. The wording itself is pinned by e2e/calendar-pin.spec.js; here it is only the sign
 * that the real exchange reached the same end.
 */
const PIN_ENDED_NOTICE = (readFileSync(new URL('../login-overlay.js', import.meta.url), 'utf8')
    .match(/\bSTAFF_PIN_ENDED_NOTICE\s*=\s*'((?:\\.|[^'\\])*)'/)?.[1] ?? '').replace(/\\(.)/g, '$1');

/** @param {import('@playwright/test').Page} page */
function quietNotices(page) {
    return page.addInitScript((keys) => {
        for (const k of keys) { try { localStorage.setItem(k, '1'); } catch { /* private mode: nothing to quieten */ } }
    }, NOTICE_KEYS);
}

/**
 * The first Tuesday, Wednesday or Thursday at least `ahead` days from today that `name` WORKS on the
 * base roster — so leave is an ordinary booking (no rest-day question), never a Sunday, a bank
 * holiday or the Christmas fortnight, and inside the years the Calendar shows.
 * @param {string} name
 * @param {number} [ahead]
 */
function workingDay(name, ahead = 21) {
    const member = teamMembers.find((m) => m.name === name);
    if (!member) throw new Error(`${name} is in the server roster but not in teamMembers — regenerate roster-members.json`);
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() + ahead);
    for (let i = 0; i < 120; i++, d.setDate(d.getDate() + 1)) {
        const dow = d.getDay();
        if (dow < 2 || dow > 4 || isBankHoliday(d) || d.getFullYear() > CONFIG.MAX_YEAR) continue;
        if (d.getMonth() === 11 && d.getDate() >= 20) continue;
        if (/^\d\d:\d\d-\d\d:\d\d$/.test(getBaseShift(member, d))) {
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        }
    }
    throw new Error(`no working Tuesday–Thursday found for ${name} in the next 120 days`);
}

/**
 * How the Calendar labels `day` on its cell (`data-detail-day`), e.g. "Tuesday 1 December 2026".
 * @param {string} day  YYYY-MM-DD
 */
function dayLabel(day) {
    const [y, m, d] = day.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).replace(',', '');
}

test.beforeEach(async ({ page }) => {
    expect(NOTICE_KEYS.length, 'calendar-notices.js no longer declares its notices as DONE_KEY — update quietNotices').toBeGreaterThan(0);
    await resetDatabase();
    await resetPasswords([MEMBER, COLLEAGUE, MANAGER, DESIGNER]);
    await quietNotices(page);
});

/**
 * Sign in as a first-time member: the surname default on the sign-in card, then the compelled "set
 * your own password" screen, answered. Leaves the page signed in and past the screen.
 * @param {import('@playwright/test').Page} page
 * @param {string} name
 */
async function signInFirstTime(page, name) {
    await signInThroughOverlay(page, name);
    const force = page.locator('#pwForceOverlay');
    await expect(force, 'a member on the surname default is sent to "set your own password"').toBeVisible();
    await page.locator('#pwfNew').fill(OWN_PASSWORD);
    await page.locator('#pwfConfirm').fill(OWN_PASSWORD);
    await page.locator('#pwfSave').click();
    await expect(force).toBeHidden();
}

/**
 * Open Admin's week on `day`, through the page's own date field.
 * @param {import('@playwright/test').Page} page
 * @param {string} day  YYYY-MM-DD
 */
async function openAdminWeek(page, day) {
    await expect(page.locator('.day-row').first()).toBeVisible();
    await page.locator('#fieldDate').evaluate((el, value) => {
        /** @type {HTMLInputElement} */ (el).value = value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }, day);
    await expect(page.locator(`.day-row[data-date="${day}"]`)).toBeVisible();
}

/**
 * Stage one day the way a phone does it: tick the day, choose the type in the "apply to several days"
 * bar, apply. (On a phone the row's own buttons only appear once the row is opened, so this is the
 * route most staff take.)
 * @param {import('@playwright/test').Page} page
 * @param {string} day   YYYY-MM-DD
 * @param {'annual_leave'|'sick'} type
 */
async function stageDay(page, day, type) {
    await page.locator(`.day-row[data-date="${day}"]`).getByRole('checkbox').check();
    await page.locator(`#bulkTypePills .pill-${type}`).click();
    await page.locator('#bulkApplyBtn').click();
}

/** @param {string} memberName @param {string} date */
async function overridesFor(memberName, date) {
    return (await readCollection('overrides')).filter((d) => d.memberName === memberName && d.date === date);
}

test('first sign-in: the surname opens the door once, the member must choose their own, and the surname is refused after', async ({ page }) => {
    await page.goto('/');
    await signInFirstTime(page, MEMBER);
    await expect(page.locator('.calendar-day').first()).toBeVisible();

    // The record of the change lands, under the member's own name — the rules accepted the page's
    // write. It is a background write (firebase-client.js → writeWithClaimRetry), so it is waited for.
    await expect.poll(async () => (await readCollection('passwordStatus')).some((d) => d._id === MEMBER),
        { message: 'the "own password" record must reach the database' }).toBe(true);

    // Sign out, then the surname no longer works and the chosen password does.
    await page.locator('#navMenuBtn').click();
    await page.locator('#navSignOutBtn').click();
    await expect(page.locator('#loginOverlay')).toBeVisible();
    await signInThroughOverlay(page, MEMBER);
    await expect(page.locator('#loginError'), 'the surname must be refused once a password of their own is set').toBeVisible();
    await page.locator('#loginPassword').fill(OWN_PASSWORD);
    await page.locator('#loginSubmit').click();
    await expect(page.locator('#loginOverlay')).toBeHidden();
    await expect(page.locator('#pwForceOverlay'), 'a migrated member is not asked again').toBeHidden();
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    expectNothingLeftForGoogle(page);
});

test('a day of leave: Admin\'s own save passes the rules, survives a reload, and the Calendar draws it', async ({ page }) => {
    const day = workingDay(MEMBER);
    await page.goto('/admin.html');
    await signInFirstTime(page, MEMBER);
    await openAdminWeek(page, day);
    await stageDay(page, day, 'annual_leave');
    await page.locator('#saveBtn').click();
    await expect(page.locator('#formFeedback')).toContainText(`1 change saved for ${MEMBER}`);

    const saved = await overridesFor(MEMBER, day);
    expect(saved, 'exactly one record for the day').toHaveLength(1);
    expect(saved[0]).toMatchObject({ type: 'annual_leave', value: 'AL', source: 'manual', changedBy: MEMBER });
    expect(saved[0]._id, 'a manual record is filed under its fixed id').toBe(manualOverrideId(MEMBER, day));

    // Read back through the rules, not from the page's memory of having written it.
    await page.reload();
    await openAdminWeek(page, day);
    await expect(page.locator(`.day-row[data-date="${day}"] .type-pill-btn[data-type="annual_leave"]`)).toHaveAttribute('aria-pressed', 'true');

    await page.goto(`/?date=${day}`);
    await expect(page.locator(`.calendar-day[data-detail-day="${dayLabel(day)}"]`)).toHaveAttribute('data-detail-shift-value', 'AL');
    expectNothingLeftForGoogle(page);
});

test('a colleague\'s day: the rules refuse it from a member\'s own browser, and accept the same write for themselves', async ({ page }) => {
    const day = workingDay(MEMBER);
    await page.goto('/');
    await signInFirstTime(page, MEMBER);
    await expect(page.locator('.calendar-day').first()).toBeVisible();

    // The app's own SDK instance, signed in as this member, and the app's own write builder.
    const attempt = (/** @type {string} */ whose) => page.evaluate(async ({ whose, me, day }) => {
        const fc = await import('/firebase-client.js');
        const { buildOverrideWrite } = await import('/override-utils.js');
        const { manualOverrideId } = await import('/override-id.js');
        try {
            await fc.setDoc(fc.doc(fc.db, 'overrides', manualOverrideId(whose, day)), buildOverrideWrite({
                memberName: whose, date: day, type: 'annual_leave', value: 'AL', source: 'manual', changedBy: me,
            }, fc.serverTimestamp()));
            return 'written';
        } catch (/** @type {any} */ err) {
            return err?.code || String(err);
        }
    }, { whose, me: MEMBER, day });

    expect(await attempt(COLLEAGUE), 'a member writing a colleague\'s day').toBe('permission-denied');
    expect(await attempt(MEMBER), 'the same write for their own day').toBe('written');
    expect(await overridesFor(COLLEAGUE, day), 'nothing reached the colleague\'s record').toHaveLength(0);
    expect(await overridesFor(MEMBER, day)).toHaveLength(1);
    expectNothingLeftForGoogle(page);
});

test('on behalf: a manager records a colleague\'s absence, and the colleague sees it on their own phone', async ({ page, browser }, testInfo) => {
    const day = workingDay(COLLEAGUE);
    await page.goto('/admin.html');
    await signInFirstTime(page, MANAGER);
    await page.locator('#fieldMember').selectOption(COLLEAGUE);
    await openAdminWeek(page, day);
    await stageDay(page, day, 'sick');
    await page.locator('#saveBtn').click();
    await expect(page.locator('#formFeedback')).toContainText(`1 change saved for ${COLLEAGUE}`);

    const saved = await overridesFor(COLLEAGUE, day);
    expect(saved).toHaveLength(1);
    expect(saved[0], 'the record says who made it, and it was not the colleague').toMatchObject({ type: 'sick', changedBy: MANAGER });
    expectNothingLeftForGoogle(page);

    // The colleague's own phone: a separate browser, their own first sign-in.
    const theirs = await browser.newContext({ ...testInfo.project.use, baseURL: testInfo.project.use.baseURL });
    const phone = await theirs.newPage();
    await wireToEmulators(phone);
    await quietNotices(phone);
    await phone.goto('/');
    await signInFirstTime(phone, COLLEAGUE);
    // The dated link AFTER signing in: `?date=` is honoured once and then taken off the address
    // (calendar-state.js), and the sign-in reloads the page.
    await phone.goto(`/?date=${day}`);
    await expect(phone.locator(`.calendar-day[data-detail-day="${dayLabel(day)}"]`)).toHaveAttribute('data-detail-shift-value', 'SICK');
    expectNothingLeftForGoogle(phone);
    await theirs.close();
});

test('no signal: a change saved offline says it is waiting, then reaches the database when the signal returns', async ({ page, context }) => {
    const day = workingDay(MEMBER);
    await page.goto('/admin.html');
    await signInFirstTime(page, MEMBER);
    await openAdminWeek(page, day);
    await context.setOffline(true);
    await stageDay(page, day, 'annual_leave');
    await page.locator('#saveBtn').click();
    await expect(page.locator('#slowSaveNotice')).toContainText('Waiting for signal');
    expect(await overridesFor(MEMBER, day), 'nothing can have reached the database yet').toHaveLength(0);

    await context.setOffline(false);
    await expect(page.locator('#formFeedback')).toContainText(`1 change saved for ${MEMBER}`, { timeout: 60_000 });
    await expect(page.locator('#slowSaveNotice')).toBeHidden();
    expect(await overridesFor(MEMBER, day)).toHaveLength(1);
    expectNothingLeftForGoogle(page);
});

test('back online: a delete waits for the save this device has not sent yet, and the day stays deleted', async ({ page, context }) => {
    const day = workingDay(MEMBER);
    const id = manualOverrideId(MEMBER, day);
    await page.goto('/admin.html');
    await signInFirstTime(page, MEMBER);
    await openAdminWeek(page, day);
    await context.setOffline(true);
    await stageDay(page, day, 'annual_leave');
    await page.locator('#saveBtn').click();
    await expect(page.locator('#slowSaveNotice')).toContainText('Waiting for signal');

    // The member leaves Admin with the save still waiting and opens it again once the signal is back.
    // The save is in this device's queue, which the SDK sends as it starts, on its Write stream; that
    // stream is HELD here, so the second in which the race lived stays open. A transaction's reads and
    // commit are separate requests, and pass.
    /** @type {import('@playwright/test').Route[]} */
    const held = [];
    let holding = true;
    await page.route((url) => url.host === EMULATOR.firestore && url.pathname.endsWith('/Write/channel'),
        (route) => { if (holding) held.push(route); else route.continue().catch(() => { /* the page has moved on */ }); });
    // The page goes with its save still waiting, so it keeps the staged day as a draft — with what the
    // save was sending (unsaved-draft.js, rule 6). Read as the next load starts, before the app does.
    const draft = `myb_draft_admin_${encodeURIComponent(MEMBER)}`;
    await page.addInitScript((k) => { /** @type {any} */ (window).__keptDraft = localStorage.getItem(k); }, draft);
    page.on('dialog', (d) => d.accept());   // "Leave the page?" — the save is queued, not lost
    await context.setOffline(false);
    await page.reload();
    await openAdminWeek(page, day);
    await expect.poll(() => held.length, { message: 'the SDK never tried to send the save it had queued' }).toBeGreaterThan(0);
    const kept = JSON.parse(await page.evaluate(() => /** @type {any} */ (window).__keptDraft) || 'null');
    expect(kept?.data?.sending, 'the draft kept what its save was sending').toEqual([expect.objectContaining({ date: day, type: 'annual_leave', value: 'AL' })]);
    // That save is in this device's queue, which counts: the day holds it, so it is not offered back as
    // unsaved. It used to be — "Restore your unsaved changes?", then "changed since" about this very save.
    await expect.poll(() => page.evaluate((k) => localStorage.getItem(k), draft),
        { message: 'the queued save was still kept as unsaved work' }).toBeNull();
    await expect(page.locator('.dialog-overlay.visible'), 'asked to restore a change that is saved').toHaveCount(0);

    await page.locator('#overridesToggleHeader').click();
    const del = page.locator(`#overrideTableBody .btn-delete[data-id="${id}"]`);
    await del.click();
    await expect(del).toHaveText('Delete?');
    await del.click();

    // While the save is held the delete must not go ahead: the server does not hold the day yet, so a
    // delete that read it now would call it already gone — and the save would then land on top.
    const early = await page.locator('#listFeedback', { hasText: 'Deleted' }).waitFor({ timeout: 2_000 }).then(() => true, () => false);
    expect(early, 'the delete went ahead before this device\'s own save had reached the database').toBe(false);
    expect(await overridesFor(MEMBER, day), 'the save is still held on this device').toHaveLength(0);

    holding = false;
    for (const route of held.splice(0)) await route.continue().catch(() => { /* the SDK gave up on it */ });
    await expect(page.locator('#listFeedback')).toContainText(`Deleted: ${MEMBER}`, { timeout: 30_000 });
    // Nothing of this device's is left to land on top of the delete…
    expect(await page.evaluate(() => import('/firebase-client.js').then((m) => m.whenOwnWritesSent(20_000))),
        'this device still had saves waiting').toBe(true);
    // …and the day is gone from the database, not put back by the save queued before it.
    expect(await overridesFor(MEMBER, day), 'the save queued offline landed after the delete and put the day back').toHaveLength(0);
    expectNothingLeftForGoogle(page);
});

test('Links, back online: a rename waits for the save this device has not sent yet, and is not undone by it', async ({ page, context }) => {
    const NAME = 'Option A';
    const RENAMED = 'Option A, renamed';
    /** The design as the database holds it, read past the rules. */
    const stored = async () => (await readCollection('linkDesigns')).find((d) => d.name === NAME || d.name === RENAMED);
    await page.addInitScript(() => { try { localStorage.setItem('myb_links_welcome_seen', '1'); } catch { /* private mode */ } });
    await page.goto('/links.html');
    await signInFirstTime(page, DESIGNER);

    // A design made with a signal, so the database holds it before anything is queued.
    await sheetAction(page, 'newDesignBtn');
    await page.locator('.dialog-overlay .dialog-input').fill(NAME);
    await clickDialogConfirm(page, '.dialog-overlay .dialog-btn-confirm');
    await expect(activeDesignName(page)).toHaveText(NAME);
    await expect.poll(async () => (await stored())?.name, { message: 'the new design must reach the database' }).toBe(NAME);

    // No signal: a change to the staffed window is saved into this device's queue (store rule 4). The
    // store tries its transaction first, which takes a few seconds to give up offline.
    await context.setOffline(true);
    await page.locator('#winMonSatEnd').fill('14:20');
    await page.locator('#winMonSatEnd').dispatchEvent('change');
    await page.locator('#linksSaveBtn').click();
    await expect(page.locator('#linksSaveStatus')).toContainText('Saved in this browser', { timeout: 45_000 });

    // The signal returns with the SDK's write stream HELD, so the queued save cannot land yet, and the
    // design is renamed meanwhile. A rename is a transaction, which reads the server: without the
    // wait it read the design before the queued save, committed, and the save — a whole design,
    // name included — then landed on top and put the old name back. Store rule 5 (v25.96).
    /** @type {import('@playwright/test').Route[]} */
    const held = [];
    let holding = true;
    await page.route((url) => url.host === EMULATOR.firestore && url.pathname.endsWith('/Write/channel'),
        (route) => { if (holding) held.push(route); else route.continue().catch(() => { /* the page has moved on */ }); });
    await context.setOffline(false);
    await expect.poll(() => held.length, { message: 'the SDK never tried to send the save it had queued', timeout: 30_000 }).toBeGreaterThan(0);
    await sheetAction(page, 'designRenameMenuBtn');
    await page.locator('.dialog-overlay .dialog-input').fill(RENAMED);
    await clickDialogConfirm(page, '.dialog-overlay .dialog-btn-confirm');

    const early = await expect(activeDesignName(page)).toHaveText(RENAMED, { timeout: 2_000 }).then(() => true, () => false);
    expect(early, 'the rename went ahead before this device\'s own save had reached the database').toBe(false);
    expect((await stored())?.name, 'nothing of the rename can have reached the database yet').toBe(NAME);

    holding = false;
    for (const route of held.splice(0)) await route.continue().catch(() => { /* the SDK gave up on it */ });
    await expect(activeDesignName(page)).toHaveText(RENAMED, { timeout: 30_000 });
    // Nothing of this device's is left to land on top of the rename…
    expect(await page.evaluate(() => import('/firebase-client.js').then((m) => m.whenOwnWritesSent(20_000))),
        'this device still had saves waiting').toBe(true);
    // …and the database holds both: the save from before the signal returned, and the rename after it.
    const after = await stored();
    expect(after?.name, 'the save queued offline landed after the rename and put the old name back').toBe(RENAMED);
    expect(after?.window?.monSat?.end, 'the change saved offline never reached the database').toBe('14:20');
    expectNothingLeftForGoogle(page);
});

test('the staff PIN: the real exchange opens the Calendar, the viewer reads a record through the rules, and Admin ends it with the notice', async ({ page }) => {
    const pin = process.env.E2E_VIEWER_PIN;
    expect(pin, 'run this lane with `npm run test:signed-in`, which gives the emulator a PIN for the run').toMatch(/^\d{4}$/);
    const day = workingDay(MEMBER);
    await seedDocument(`overrides/${manualOverrideId(MEMBER, day)}`, {
        memberName: MEMBER, date: day, type: 'annual_leave', value: 'AL', note: '', source: 'manual', changedBy: MEMBER,
    });

    await page.goto(`/?date=${day}`);
    await enterPin(page, /** @type {string} */ (pin));
    await expect(page.locator('#calLockPin'), 'the PIN card closes once the exchange is accepted').toBeHidden();
    // A viewer has no name of their own: the grid appears once somebody's roster is chosen.
    await page.locator('#teamMemberSelect').selectOption(MEMBER);
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    await expect(page.locator(`.calendar-day[data-detail-day="${dayLabel(day)}"]`), 'the viewer reads the record through the rules').toHaveAttribute('data-detail-shift-value', 'AL');

    await page.goto('/admin.html');
    expect(PIN_ENDED_NOTICE, 'login-overlay.js no longer declares STAFF_PIN_ENDED_NOTICE as one quoted string — update PIN_ENDED_NOTICE').not.toBe('');
    await expect(page.locator('#loginNotice'), 'the sign-in card says opening Admin ended the PIN').toHaveText(PIN_ENDED_NOTICE);
    await signInFirstTime(page, MEMBER);
    await expect(page.locator('.day-row').first()).toBeVisible();
    expectNothingLeftForGoogle(page);
});

test('signing out: Back loads the page again with nobody signed in, in the app or in the SDK', async ({ page }) => {
    // The shared device: signed in on Admin, on to the Calendar, signed out THERE — then Back. Here
    // Back loads Admin again (the header says why it is never the back/forward cache in this lane).
    await page.goto('/admin.html');
    await signInFirstTime(page, MEMBER);
    await expect(page.locator('.day-row').first()).toBeVisible();
    await page.locator('#navMenuBtn').click();
    await page.locator('.nav-panel-pill--calendar').click();
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    await page.locator('#navMenuBtn').click();
    await page.locator('#navSignOutBtn').click();
    await expect(page.locator('#loginOverlay')).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL(/admin\.html/);
    await expect(page.locator('#loginOverlay'), 'Admin asks who you are again').toBeVisible();
    await expect(page.locator('.day-row:visible'), 'and shows nobody\'s week behind it').toHaveCount(0);

    // And the SDK's own sign-in has gone too. Firebase keeps it in the browser's storage, where it
    // would still carry the member's claims to anything that read it. Two things end it: the sign-out
    // itself, and the clean-up each protected page runs on opening (reconcileExpiredIdentity) — so
    // this is polled, and either alone keeps it green.
    await expect.poll(() => page.evaluate(async () => {
        const { auth } = await import('/firebase-client.js');
        await auth.authStateReady();
        return auth.currentUser?.uid ?? null;
    }), { message: 'Firebase still holds the member after they signed out' }).toBeNull();
    expectNothingLeftForGoogle(page);
});
