/**
 * calendar-notices.spec.js — the Calendar (index.html): the install strip and the one-time notices —
 * install, New link and the timetable — and their order.
 *
 * Split by feature out of calendar.spec.js on 25 Nov 2026, test for test and unchanged; what more than
 * one calendar-*.spec.js file needs is in calendar-helpers.js. Every file keeps the old file's
 * `beforeEach`, so each test still starts signed in as a member. The Calendar's access gate is
 * calendar-access.spec.js.
 */
import { test, expect } from './fixtures.js';
import { CONFIG, teamMembers } from '../roster-data.js';
import { collectFatalErrors, seedSession, seedMember, seedCalendarMember, seedMemberSession, isTouchProject, clearNoticeFlags } from './helpers.js';

// ── Calendar access ─────────────────────────────────────────────────────────────────────────────
// The Calendar opens only for a signed-in member (since the staff PIN was retired, 23 Nov 2026; from
// v20.12 the PIN opened it too), so a spec that simply loads index.html gets the sign-in card and none
// of the roster. Every test in this file is about what the Calendar DOES once it is open, not about
// the gate, so each page starts signed in as a member with no calendar picked on this device
// (`seedCalendarMember`) — the member's own calendar. Until the PIN went it started on a PIN viewer,
// whose `getSession()` was null; the tests that existed only for that state (the first-run prompt,
// the station PC's Team View and bug report) went with it. The gate itself is calendar-access.spec.js.
test.beforeEach(async ({ page }) => { await seedCalendarMember(page); });

// ── The install strip, and the one thing about it a unit test cannot see (v22.28) ────────────────
//
// The rules in `install-prompt.js` are small enough to look obviously right; the WIRING is where
// this feature can fail, and it fails silently in both directions. So these drive the real page.
//
// The precedence rule is the one worth the most care, and the naive version of this test is
// VACUOUS: headless Chromium has no push service, so `notifSupported()` is false and `#notifPrompt`
// never shows — an assertion that it is hidden would pass with the suppression line deleted. The
// test therefore puts the notification strip on screen FIRST and asserts the install strip takes it
// down, which is the line executing rather than the situation happening not to arise.

/** Put the page in the state the strip is designed for, then fire the browser's install event. */
async function armInstall(page, { showNotif = false, width = 390 } = {}) {
    await page.setViewportSize({ width, height: 800 });   // the strip is mobile-only — see below
    await seedMemberSession(page, 'G. Miller');
    await page.goto('/');
    await page.waitForSelector('#calendarDisplay table, #calendarDisplay .calendar-container', { timeout: 15_000 });
    if (showNotif) await page.evaluate(() => { document.getElementById('notifPrompt').style.display = 'flex'; });
    await page.evaluate(() => {
        const e = new Event('beforeinstallprompt');
        /** @type {any} */ (e).prompt = () => { /** @type {any} */ (window).__promptFired = true; return Promise.resolve(); };
        window.dispatchEvent(e);
    });
    await expect(page.locator('#installPrompt')).toBeVisible();
}

test('install strip: it offers a real Install button once the browser says it can', async ({ page }) => {
    await armInstall(page);
    await expect(page.locator('#installPromptAction')).toBeVisible();
    // The manual iOS steps are the OTHER branch and must not be showing beside a working button.
    await expect(page.locator('#installPromptSteps')).toBeHidden();
});

test('install strip: it takes the notification ask off screen WITHOUT marking it done', async ({ page }) => {
    await armInstall(page, { showNotif: true });
    await expect(page.locator('#notifPrompt')).toBeHidden();
    // The whole point of hiding rather than dismissing: the notification ask returns next visit.
    // Trading one prompt for the other is not what "one at a time" means.
    expect(await page.evaluate(() => localStorage.getItem('myb_notif_prompt_done'))).toBeNull();
});

test('install strip: pressing Install fires the browser prompt and does not come back', async ({ page }) => {
    await armInstall(page);
    await page.locator('#installPromptAction').click();
    expect(await page.evaluate(() => /** @type {any} */ (window).__promptFired)).toBe(true);
    await expect(page.locator('#installPrompt')).toBeHidden();
    expect(await page.evaluate(() => localStorage.getItem('myb_install_prompt_done'))).toBe('1');
    // …and a "Cancel" in Chrome's dialog does not bring it back (whole-app review, 10 Nov 2026):
    // Chromium fires `beforeinstallprompt` again once the member's choice resolves, and the strip
    // used to show itself for any offer that arrived.
    await page.evaluate(() => {
        const again = new Event('beforeinstallprompt', { cancelable: true });
        /** @type {any} */ (again).prompt = () => Promise.resolve();
        window.dispatchEvent(again);
    });
    await page.waitForTimeout(100);   // the handler's accessReady hop
    await expect(page.locator('#installPrompt')).toBeHidden();
});

// ── AN UNREADABLE `--prompt-available` FAILS CLOSED (v22.32, external review) ───────────────────
//
// `canBeSeen` read `!== '0'` first, which meant an UNREADABLE property ('' from a browser with no
// custom-property support) counted as "yes": we would capture `beforeinstallprompt`, suppressing
// the browser's own install promotion, while the strip stayed CSS-hidden. No offer from anyone —
// the one outcome the width check exists to prevent.
//
// No shipping browser does this (Chromium supports both), so the mutation is invisible in a normal
// run and no ordinary test can have teeth on it. Removing the property is what makes the branch
// reachable, and the assertion is on `defaultPrevented`: failing closed means we never registered,
// so the browser keeps its own offer.
test('install strip: an unreadable width flag leaves the browser its own offer', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await seedMemberSession(page, 'G. Miller');
    // Serve the stylesheet with the declaration REMOVED, so the property is undefined from the
    // first paint. Injecting a style after load is too late: the module reads the flag as it runs.
    await page.route('**/index.css', async route => {
        const res = await route.fetch();
        const css = (await res.text()).replace('--prompt-available: 1;', '');
        await route.fulfill({ response: res, body: css, headers: { ...res.headers(), 'content-type': 'text/css' } });
    });
    await page.goto('/');
    await page.waitForSelector('#calendarDisplay table, #calendarDisplay .calendar-container', { timeout: 15_000 });
    const prevented = await page.evaluate(() => {
        const e = new Event('beforeinstallprompt', { cancelable: true });
        /** @type {any} */ (e).prompt = () => Promise.resolve();
        window.dispatchEvent(e);
        return e.defaultPrevented;
    });
    expect(prevented,
        'an unreadable flag must NOT be read as "yes" — capturing here suppresses the browser\'s '
        + 'own offer while our strip stays hidden').toBe(false);
    await expect(page.locator('#installPrompt')).toBeHidden();
});

test('install strip: on desktop it leaves the browser its OWN install offer', async ({ page }) => {
    // The strip is hidden at desktop widths, so capturing `beforeinstallprompt` there would suppress
    // Chrome's omnibox promotion and put nothing in its place. The observable half of that rule is
    // that the event is NOT preventDefault()ed — which is why this asserts on the event, not the DOM.
    await armInstall(page, { width: 1280 }).catch(() => { /* the strip never shows; that is the point */ });
    const prevented = await page.evaluate(() => {
        const e = new Event('beforeinstallprompt', { cancelable: true });
        /** @type {any} */ (e).prompt = () => Promise.resolve();
        window.dispatchEvent(e);
        return e.defaultPrevented;
    });
    expect(prevented).toBe(false);
    await expect(page.locator('#installPrompt')).toBeHidden();
});

// ── The install notice: the strip's whole case, made once (v24.91) ────────────────────────────────
//
// What calendar-notices.test.mjs cannot see, because it fakes install-prompt.js: that the REAL
// detection reads a real phone's browser the way the notice needs, that the browser's real install
// offer reaches the notice's button, and that the strip really leaves the screen. The rules
// themselves — the order, the audience, every "how", the mirror — are pinned there.
//
// The user agent is set per describe rather than taken from the project, so both touch engines run
// both platforms' copy: what decides "Share" or "the menu" is the platform, not the engine.
const INSTALL_NOTICE_DAY = new Date('2026-10-22T09:00:00Z');   // its posting day; 90 days to run
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';
const IPHONE_UA  = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

/** A member's phone browser whose earlier loads answered the timetable and Year to Date notices. */
async function memberDueTheInstallNotice(page) {
    await page.clock.setFixedTime(INSTALL_NOTICE_DAY);
    await seedSession(page, 'G. Miller');
    await seedMemberSession(page, 'G. Miller');
    await seedMember(page);
    await clearNoticeFlags(page, ['myb_notice_install_app_2026_done']);   // after the seeders: last write wins
}

/** The browser's install offer, as Chromium would hand it over — `window.__promptFired` records a use. */
function offerInstall(page) {
    return page.evaluate(() => {
        const e = new Event('beforeinstallprompt', { cancelable: true });
        /** @type {any} */ (e).prompt = () => { /** @type {any} */ (window).__promptFired = true; return Promise.resolve(); };
        window.dispatchEvent(e);
    });
}

test.describe('install notice — in an Android browser', () => {
    test.use({ userAgent: ANDROID_UA });

    test('it takes the strip\'s place, and its one tap is the browser\'s own offer', async ({ page }, info) => {
        test.skip(!isTouchProject(info), 'it is offered only on a touch screen');
        const errors = collectFatalErrors(page);
        await memberDueTheInstallNotice(page);
        await page.goto('/');
        await page.waitForSelector('#calendarDisplay table, #calendarDisplay .calendar-container', { timeout: 15_000 });
        await offerInstall(page);                             // inside the 1,500ms the notice waits
        const notice = page.locator('#installNoticeLb');
        await expect(notice).toHaveClass(/\bopen\b/, { timeout: 15_000 });
        await expect(page.locator('#installNoticeInstall')).toBeVisible();
        for (const id of ['#installNoticeMenu', '#installNoticeIos', '#installNoticeMirror', '#installNoticeGo', '#installNoticeHave',
                          '#installNoticeSafari', '#installNoticeIosStore']) {
            await expect(page.locator(id), `${id} is another browser's answer`).toBeHidden();
        }
        // The browser's offer would have put the strip up too. One ask at a time: it has stood down.
        await expect(page.locator('#installPrompt')).toBeHidden();
        await page.locator('#installNoticeInstall').click();
        expect(await page.evaluate(() => /** @type {any} */ (window).__promptFired), 'the real offer, spent').toBe(true);
        await expect(notice).not.toHaveClass(/\bopen\b/);
        expect(await page.evaluate(() => [localStorage.getItem('myb_notice_install_app_2026_done'),
                                          localStorage.getItem('myb_install_prompt_done')]),
            'answered — and the strip will not ask again').toEqual(['1', '1']);
        expect(errors).toHaveLength(0);
    });

    test('with no offer from the browser it names the menu — and closing it is an answer', async ({ page }, info) => {
        test.skip(!isTouchProject(info), 'it is offered only on a touch screen');
        const errors = collectFatalErrors(page);
        await memberDueTheInstallNotice(page);
        await page.goto('/');
        const notice = page.locator('#installNoticeLb');
        await expect(notice).toHaveClass(/\bopen\b/, { timeout: 15_000 });
        await expect(notice).toContainText('Put the roster on your home screen');
        await expect(page.locator('#installNoticeMenu')).toBeVisible();
        await expect(page.locator('#installNoticeHave'), 'it may already be installed: Chrome offers only where it is not').toBeVisible();
        await expect(page.locator('#installNoticeActions'), 'nothing to press — the browser\'s menu does it').toBeHidden();
        // Android keeps ONE storage for the browser and the installed app, so the iPhone's storage
        // lines (sign in again, the figures stay behind) would tell an Android member something false.
        await expect(page.locator('#installNoticeSafari')).toBeHidden();
        await expect(page.locator('#installNoticeIosStore')).toBeHidden();
        await page.locator('#installNoticeClose').click();
        await expect(notice).not.toHaveClass(/\bopen\b/);
        expect(await page.evaluate(() => [localStorage.getItem('myb_notice_install_app_2026_done'),
                                          localStorage.getItem('myb_install_prompt_done')])).toEqual(['1', '1']);
        const archived = await page.evaluate(() =>
            JSON.parse(localStorage.getItem('myb_app_notices') || '[]').map((/** @type {{ id: string }} */ n) => n.id));
        expect(archived, 'kept in the drawer\'s App Notices').toContain('install-app-2026');
        expect(errors).toHaveLength(0);
    });
});

test.describe('install notice — on an iPhone', () => {
    test.use({ userAgent: IPHONE_UA });

    test('it says Share, then Add to Home Screen — and the strip saying the same has stood down', async ({ page }, info) => {
        test.skip(!isTouchProject(info), 'it is offered only on a touch screen');
        const errors = collectFatalErrors(page);
        await memberDueTheInstallNotice(page);
        await page.goto('/');
        const notice = page.locator('#installNoticeLb');
        await expect(notice).toHaveClass(/\bopen\b/, { timeout: 15_000 });
        await expect(page.locator('#installNoticeIos')).toBeVisible();
        await expect(page.locator('#installNoticeIos')).toContainText('Add to Home Screen');
        await expect(page.locator('#installNoticeMenu')).toBeHidden();
        await expect(page.locator('#installNoticeActions')).toBeHidden();
        // On an iPhone the strip shows its own steps the moment access is decided — the same moment
        // the notice is decided — so this is the strip coming up and going straight back down.
        await expect(page.locator('#installPrompt')).toBeHidden();
        expect(errors).toHaveLength(0);
    });

    // THE iPHONE IS TOLD WHAT THE INSTALL COSTS (iPhone audit, 7 Nov 2026). Its Home Screen app keeps its
    // own storage, so the member is signed out there and the Pay Calculator's figures stay behind in the
    // browser — the notice promised the opposite. And Share is under ••• on iOS 26, and absent from an
    // email or chat app altogether. Driven through the real detection, at the smallest iPhone that runs
    // iOS 16.4 (the SE, 375×667), because these lines made the card longer than its screen: 654px against
    // a 532px cap, measured on WebKit (lightbox review, 22 Nov 2026). Cut to fit, as the skill's lesson asks.
    test('it says where Share is, to open in Safari first, and what stays behind — and all of it fits an iPhone SE', async ({ page }, info) => {
        test.skip(!isTouchProject(info), 'it is offered only on a touch screen');
        const errors = collectFatalErrors(page);
        await page.setViewportSize({ width: 375, height: 667 });
        await memberDueTheInstallNotice(page);
        await page.goto('/');
        const notice = page.locator('#installNoticeLb');
        await expect(notice).toHaveClass(/\bopen\b/, { timeout: 15_000 });
        await expect(page.locator('#installNoticeIos')).toContainText('on iOS 26 or later, Share is under •••');
        await expect(page.locator('#installNoticeSafari')).toBeVisible();
        await expect(page.locator('#installNoticeSafari')).toContainText('Open it in Safari first');
        await expect(page.locator('#installNoticeIosStore')).toContainText('sign in there once');
        const pay = page.locator('#installNoticePayIos');
        await expect(pay).toBeVisible();
        await expect(pay).toContainText('Move Your Pay Data');
        await expect(page.locator('#installNoticePay'), 'the mirror\'s line, which says the figures stay at an ADDRESS').toBeHidden();
        await expect(notice).not.toContainText('your saved pay figures are far less likely');
        // THE WHOLE CARD FITS — no line under the fade, and the ✕ is not the only way out that can be seen.
        // scrollHeight against clientHeight, never a screenshot: a card caught mid-animation is scaled.
        await expect(page.locator('#installNoticeHave'), 'folded into the iPhone line').toBeHidden();
        await page.waitForTimeout(600);   // past the open's scale-in
        const fit = await page.locator('#installNoticeContent').evaluate(el => ({ scroll: el.scrollHeight, client: el.clientHeight }));
        expect(fit.scroll, `the card scrolls: ${fit.scroll}px of content in ${fit.client}px`).toBeLessThanOrEqual(fit.client);
        const close = page.locator('#installNoticeClose');
        await expect(close).toBeInViewport();
        await close.click();
        await expect(notice).not.toHaveClass(/\bopen\b/);
        const archived = await page.evaluate(() =>
            JSON.parse(localStorage.getItem('myb_app_notices') || '[]').find((/** @type {{ id: string }} */ n) => n.id === 'install-app-2026')?.body);
        expect(archived, 'the App Notices record keeps the same three points').toMatch(/under •••[\s\S]*Safari first[\s\S]*Move Your Pay Data/);
        expect(errors).toHaveLength(0);
    });

    test('the strip names the ••• too, and still fits the smallest iPhone', async ({ page }, info) => {
        // The strip asks on any later visit the notice did not take — once the notice is answered or
        // past its 90 days. Its iOS line is the two taps plus where Share is on iOS 26.
        test.skip(!isTouchProject(info), 'the strip is mobile-only');
        const errors = collectFatalErrors(page);
        await page.setViewportSize({ width: 375, height: 667 });
        await seedMemberSession(page, 'G. Miller');      // the notice is flagged done, so the strip is not stood down
        await page.goto('/');
        const strip = page.locator('#installPrompt');
        await expect(strip).toBeVisible({ timeout: 15_000 });
        const steps = page.locator('#installPromptSteps');
        await expect(steps).toBeVisible();
        await expect(steps).toHaveText('Tap Share, then Add to Home Screen (iOS 26 or later: Share is under •••) — on an iPhone it’s also what lets notifications work.');
        await expect(page.locator('#installPromptAction'), 'WebKit has no install event, so there is nothing to press').toBeHidden();
        const fit = await page.evaluate(() => {
            const s = /** @type {HTMLElement} */ (document.getElementById('installPrompt')).getBoundingClientRect();
            const x = /** @type {HTMLElement} */ (document.getElementById('installPromptDismiss')).getBoundingClientRect();
            return { right: s.right, dismissRight: x.right, width: document.documentElement.clientWidth };
        });
        expect(fit.right, 'the strip stays inside the page').toBeLessThanOrEqual(fit.width);
        expect(fit.dismissRight, 'and its × stays on screen').toBeLessThanOrEqual(fit.width);
        expect(errors).toHaveLength(0);
    });
});

test('install notice: never on a desktop — and not flagged there, so the member\'s phone still gets it', async ({ page }, info) => {
    test.skip(isTouchProject(info), 'a touch screen is where it IS offered — the describes above');
    const errors = collectFatalErrors(page);
    await memberDueTheInstallNotice(page);
    await page.goto('/');
    await page.waitForSelector('#calendarDisplay table, #calendarDisplay .calendar-container', { timeout: 15_000 });
    await page.waitForTimeout(2500);                          // past the 1,500ms defer
    await expect(page.locator('#installNoticeLb')).not.toHaveClass(/\bopen\b/);
    expect(await page.evaluate(() => localStorage.getItem('myb_notice_install_app_2026_done'))).toBeNull();
    expect(errors).toHaveLength(0);
});

// ── The New link notice: only where the page would let them in, after the install notice (v25.61) ───
//
// What calendar-notices.test.mjs cannot see, because it fakes the page: that a real colleague's real
// sign-in reaches the gate, that the link really lands them ON the New link page (which turns away
// anybody the notice should not have told), and that on a real phone the order holds across reloads.
// Who it is for, every name on the roster, and the dates are pinned there.
const NEWLINK_NOTICE_DAY = new Date('2026-11-27T09:00:00Z');   // the day after the vote notice's posting; offered to 5 Dec
/** Somebody on the roster who fits — found, not named, so a leaver cannot break a test (newlink.spec.js's rule),
 *  and never on a role list, which would reach the page by that list instead. @param {string} what
 *  @param {(m: any) => boolean} fits @returns {string} */
function rosterSomeone(what, fits) {
    const roles = [...CONFIG.ADMIN_NAMES, ...(CONFIG.MANAGER_NAMES || []), ...(CONFIG.NEWLINK_PREVIEW || [])];
    const m = teamMembers.find(x => !x.hidden && !x.managerOnly && !roles.includes(x.name) && fits(x));
    if (!m) throw new Error(`the roster has no ${what}`);
    return m.name;
}
const NEWLINK_COLLEAGUE = rosterSomeone('CEA on a normal contract', m => m.role === 'CEA' && !m.bilingualContract);
const NOT_NEWLINK       = rosterSomeone('CEA on a bilingual contract', m => m.role === 'CEA' && m.bilingualContract);

test('New link notice: a colleague the page is for is told, and its link takes them onto the page (v25.61; the vote notice, v26.90)', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.clock.setFixedTime(NEWLINK_NOTICE_DAY);
    await seedSession(page, NEWLINK_COLLEAGUE);
    await seedMemberSession(page, NEWLINK_COLLEAGUE);
    await clearNoticeFlags(page, ['myb_notice_newlink_vote_2026_done']);   // after the seeders: last write wins
    await page.goto('/');
    const notice = page.locator('#newlinkNoticeLb');
    await expect(notice, 'on a desk there is no install notice to wait for, and on a phone the seeders answered it')
        .toHaveClass(/\bopen\b/, { timeout: 15_000 });
    await expect(page.locator('#newlinkNoticeContent .lightbox-app-name')).toHaveText('Voting on the new link starts soon');
    // The flag is read AS THE LINK IS PRESSED, not on the page it opens: the init scripts run again on that navigation,
    // and the one that re-enabled this notice for the test clears the flag — in whichever order they happen to run.
    // A document listener bubbles after the link's own, and sessionStorage survives the navigation untouched.
    await page.evaluate(() => document.addEventListener('click', () => {
        sessionStorage.setItem('__newlinkDoneAtClick', localStorage.getItem('myb_notice_newlink_vote_2026_done') ?? 'unset');
    }));
    await page.locator('#newlinkNoticeGo').click();
    await expect(page).toHaveURL(/\/newlink\.html$/);
    await expect(page.locator('.nl-name-title').first(), 'the page let them in — the notice told somebody it is for')
        .toBeVisible({ timeout: 15_000 });
    expect(await page.evaluate(() => sessionStorage.getItem('__newlinkDoneAtClick')), 'the link marks it done as it is pressed').toBe('1');
    const filed = await page.evaluate(() => JSON.parse(localStorage.getItem('myb_app_notices') || '[]')
        .filter((/** @type {any} */ n) => n.id === 'newlink-vote-2026').map((/** @type {any} */ n) => n.section));
    expect(filed, 'archived on open, under its own section').toEqual(['New CEA Link']);
    expect(errors).toHaveLength(0);
});

// ONE BACK FROM THE PAGE THE LINK OPENED RETURNS TO THE CALENDAR (18 Nov 2026). The link was a plain <a href>, and the
// open notice held a history entry with the Calendar's own address, so the New link page stacked on top of it: Back
// came back to that entry, and — the Calendar reloaded, with nothing left to answer it — the Back after that did
// nothing at all, one press more to leave an installed app. The link now REPLACES the notice's entry, as the drawer's
// links replace the drawer's (overlay.js `followLinkOutOf`). Playwright runs with the back/forward cache off, so Back
// always reloads here — the case a phone meets whenever the page has a database connection open.
test('New link notice: one Back from the page its link opened returns to the Calendar, and the next Back leaves it', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.clock.setFixedTime(NEWLINK_NOTICE_DAY);
    await seedSession(page, NEWLINK_COLLEAGUE);
    await seedMemberSession(page, NEWLINK_COLLEAGUE);
    // Offered on the FIRST Calendar load only, after the seeders: the link answers it, and the Calendar that Back
    // reloads must not offer it again (sessionStorage outlives the navigations; the seeders re-mark it done).
    await page.addInitScript(() => {
        if (location.pathname !== '/' || sessionStorage.getItem('__e2e_newlink_offered')) return;
        sessionStorage.setItem('__e2e_newlink_offered', '1');
        localStorage.removeItem('myb_notice_newlink_vote_2026_done');
    });
    await page.goto('/railcard-guide.html');                   // where the member came from
    await page.goto('/');
    await expect(page.locator('#newlinkNoticeLb')).toHaveClass(/\bopen\b/, { timeout: 15_000 });
    await page.locator('#newlinkNoticeGo').click();
    await expect(page).toHaveURL(/\/newlink\.html$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    expect(await page.evaluate(() => history.state?.mybOverlay ?? null),
        'Back landed on the notice\'s own entry, whose next Back nothing answers').toBeNull();
    await page.goBack();
    await expect(page, 'one more Back leaves the Calendar').toHaveURL(/\/railcard-guide\.html$/);
    expect(errors).toHaveLength(0);
});

test('New link notice: never for a colleague the page turns away — and not flagged (v25.61)', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.clock.setFixedTime(NEWLINK_NOTICE_DAY);
    await seedSession(page, NOT_NEWLINK);
    await seedMemberSession(page, NOT_NEWLINK);
    await clearNoticeFlags(page, ['myb_notice_newlink_vote_2026_done']);
    await page.goto('/');
    await page.waitForSelector('#calendarDisplay table, #calendarDisplay .calendar-container', { timeout: 15_000 });
    await page.waitForTimeout(2500);                          // past the 1,500ms defer
    await expect(page.locator('#newlinkNoticeLb')).not.toHaveClass(/\bopen\b/);
    expect(await page.evaluate(() => localStorage.getItem('myb_notice_newlink_vote_2026_done')), 'refused, so left unflagged').toBeNull();
    expect(errors).toHaveLength(0);
});

test('on a phone, the New link notice comes the load after the install notice — never both at once (v25.61)', async ({ page }, info) => {
    // The owner's "third in sequence", on a real page across real reloads. The session is seeded WITHOUT the
    // seeders' notice flags, as in the test above this block: here the flags are the subject. By 27 November the
    // October notices have ended and flag themselves; the install notice is still running. The timetable notice runs
    // then too, and comes after these two (its own test, below) — answered here, so this one is about the pair.
    test.skip(!isTouchProject(info), 'the install notice is offered only on a touch screen');
    test.setTimeout(90_000);
    const errors = collectFatalErrors(page);
    await page.clock.setFixedTime(NEWLINK_NOTICE_DAY);
    await page.addInitScript((n) => {
        localStorage.setItem('myb_admin_session', JSON.stringify({
            name: n, ver: 2, expiry: Date.now() + 90 * 24 * 60 * 60 * 1000,
        }));
        localStorage.setItem('myb_roster_selected_member', n);
        /** @type {any} */ (window).__E2E = Object.assign(/** @type {any} */ (window).__E2E || {}, { authUser: true });
        // ONCE: the file's default member suppressed the notices on the first load, and each answer
        // below must survive the reload that follows it (helpers.js → seedCalendarMember).
        if (!sessionStorage.getItem('__e2e_flags_cleared')) {
            sessionStorage.setItem('__e2e_flags_cleared', '1');
            for (const k of ['myb_notice_install_app_2026_done', 'myb_notice_newlink_vote_2026_done']) localStorage.removeItem(k);
            localStorage.setItem('myb_notice_timetable_soon_2026_done', '1');
            localStorage.setItem('myb_notice_team_view_2026_done', '1');   // the Team View notice, after these two: its own test
        }
    }, NEWLINK_COLLEAGUE);
    await page.goto('/');
    for (const [lb, answer] of [['#installNoticeLb', '#installNoticeClose'],
                                ['#newlinkNoticeLb', '#newlinkNoticeLater']]) {
        await expect(page.locator(lb)).toHaveClass(/\bopen\b/, { timeout: 15_000 });
        await page.locator(answer).click();
        await expect(page.locator(lb)).not.toHaveClass(/\bopen\b/);
        await page.waitForTimeout(2500);                      // past the defer: nothing follows on this load
        await expect(page.locator('.notice-lb-content:visible'), `nothing after ${lb} on its own load`).toHaveCount(0);
        await page.reload();
    }
    await page.waitForSelector('#calendarDisplay table, #calendarDisplay .calendar-container', { timeout: 15_000 });
    await page.waitForTimeout(2500);
    await expect(page.locator('.notice-lb-content:visible'), 'both answered: nothing more').toHaveCount(0);
    expect(errors).toHaveLength(0);
});

// ── The timetable notice: from 16 November after the install and New link notices, first in its final week (v26.21) ──
//
// What calendar-notices.test.mjs cannot see: the order holding on a real page across real reloads, each flag surviving a
// reload exactly as a dismissal leaves it. Who waits for what, and every date, are pinned there. Both sessions are seeded
// WITHOUT the seeders' notice flags, as in the order tests above: here the flags are the subject.
const TIMETABLE_NOTICE_DAY = new Date('2026-11-27T09:00:00Z');   // after the New link vote notice's posting (26 Nov), which it follows; offered to 12 December
const TIMETABLE_FINAL_WEEK = new Date('2026-12-07T09:00:00Z');   // inside its final week, from Sunday 6 December

/** Sign the New link colleague in on this device and open the Calendar, with no notice answered yet. */
async function colleagueWithNoNoticesAnswered(page, day) {
    await page.clock.setFixedTime(day);
    await page.addInitScript((n) => {
        localStorage.setItem('myb_admin_session', JSON.stringify({
            name: n, ver: 2, expiry: Date.now() + 90 * 24 * 60 * 60 * 1000,
        }));
        localStorage.setItem('myb_roster_selected_member', n);
        /** @type {any} */ (window).__E2E = Object.assign(/** @type {any} */ (window).__E2E || {}, { authUser: true });
        // ONCE: the file's default member suppressed the notices on the first load, and each answer
        // below must survive the reload that follows it (helpers.js → seedCalendarMember).
        if (!sessionStorage.getItem('__e2e_flags_cleared')) {
            sessionStorage.setItem('__e2e_flags_cleared', '1');
            for (const k of ['myb_notice_install_app_2026_done', 'myb_notice_newlink_vote_2026_done', 'myb_notice_timetable_soon_2026_done',
                             'myb_notice_team_view_2026_done', 'myb_notice_links_selector_2026_done']) localStorage.removeItem(k);
        }
    }, NEWLINK_COLLEAGUE);
    await page.goto('/');
}

/** Answer each notice in turn, one a load, and show nothing follows any of them on its own load or after the last. */
async function answerInOrder(page, order) {
    for (const [lb, answer] of order) {
        await expect(page.locator(lb)).toHaveClass(/\bopen\b/, { timeout: 15_000 });
        await page.locator(answer).click();
        await expect(page.locator(lb)).not.toHaveClass(/\bopen\b/);
        await page.waitForTimeout(2500);                      // past the defer: nothing follows on this load
        await expect(page.locator('.notice-lb-content:visible'), `nothing after ${lb} on its own load`).toHaveCount(0);
        await page.reload();
    }
    await page.waitForSelector('#calendarDisplay table, #calendarDisplay .calendar-container', { timeout: 15_000 });
    await page.waitForTimeout(2500);
    await expect(page.locator('.notice-lb-content:visible'), 'every one answered: nothing more').toHaveCount(0);
}

test('from 16 November the timetable notice comes after the install and New link notices, and the Team View notice after it — one a load (v26.21)', async ({ page }, info) => {
    // By the 27th the October notices have ended and flag themselves, and the New link vote notice (from the 26th) is
    // running. The install notice is offered on a touch screen only, so a desk starts at the New link notice. The Links
    // Selector notice's flag is cleared too, and it is not offered: it starts on the 28th.
    test.setTimeout(90_000);
    const errors = collectFatalErrors(page);
    await colleagueWithNoNoticesAnswered(page, TIMETABLE_NOTICE_DAY);
    await answerInOrder(page, [...(isTouchProject(info) ? [['#installNoticeLb', '#installNoticeClose']] : []),
                               ['#newlinkNoticeLb', '#newlinkNoticeLater'],
                               ['#timetableSoonNoticeLb', '#timetableSoonNoticeLater'],
                               ['#teamNoticeLb', '#teamNoticeLater']]);
    expect(errors).toHaveLength(0);
});

test('in its final week the timetable notice goes first — the install notice, still running, comes the load after (v26.21)', async ({ page }, info) => {
    // A week before the change, the reminder cannot wait behind a notice that runs to January. The New link notice ended
    // on 5 December and flags itself, so it never appears.
    test.skip(!isTouchProject(info), 'the install notice is offered only on a touch screen');
    test.setTimeout(60_000);
    const errors = collectFatalErrors(page);
    await colleagueWithNoNoticesAnswered(page, TIMETABLE_FINAL_WEEK);
    await answerInOrder(page, [['#timetableSoonNoticeLb', '#timetableSoonNoticeLater'],
                               ['#installNoticeLb', '#installNoticeClose'],
                               ['#teamNoticeLb', '#teamNoticeLater'],
                               ['#selectorNoticeLb', '#selectorNoticeLater']]);   // last in the queue (owner, 28 Nov 2026)
    expect(errors).toHaveLength(0);
});

test('Team View notice: its button opens Team Week View, and it fits the smallest phone without scrolling (owner, 27 Nov 2026)', async ({ page }) => {
    // Last in the queue: with every notice before it answered, a member on the roster gets it on 27 November. Its
    // button presses the page's own 👥 Team, and the notice is answered.
    const errors = collectFatalErrors(page);
    await page.setViewportSize({ width: 375, height: 667 });
    await page.clock.setFixedTime(TIMETABLE_NOTICE_DAY);
    await seedMemberSession(page);
    await clearNoticeFlags(page, ['myb_notice_team_view_2026_done']);
    await page.goto('/');
    const notice = page.locator('#teamNoticeLb');
    await expect(notice).toHaveClass(/\bopen\b/, { timeout: 15_000 });
    await expect(page.locator('#teamNoticeContent .lightbox-app-name')).toHaveText('See who you’re on duty with');
    await page.waitForTimeout(600);                           // the open transition, so the card is measured at rest
    const fit = await page.locator('#teamNoticeContent').evaluate(el => el.scrollHeight - el.clientHeight);
    expect(fit, 'the card scrolls inside itself on an iPhone SE').toBeLessThanOrEqual(0);
    await page.locator('#teamNoticeShow').click();
    await expect(notice).not.toHaveClass(/\bopen\b/);
    await expect(page.locator('body')).toHaveClass(/team-view-active/);
    expect(await page.evaluate(() => localStorage.getItem('myb_notice_team_view_2026_done'))).toBe('1');
    // ONE Back leaves Team View for the month, and the page stays: Team View was opened only once the
    // notice's own Back entry had gone (24-hour check, 27 Nov 2026).
    const entries = await page.evaluate(() => history.length);
    await page.goBack();
    await expect(page.locator('body')).not.toHaveClass(/team-view-active/);
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    expect(await page.evaluate(() => history.state?.mybOverlay ?? null), 'no step is left that nothing answers').toBeNull();
    expect(await page.evaluate(() => history.length)).toBe(entries);
    expect(errors).toHaveLength(0);
});

// ── The Links Selector notice: what the page is, with a link to it, 28 November – 11 December (owner, 28 Nov 2026) ──
//
// Who gets it, the order and every date are pinned in calendar-notices.test.mjs; the order on a real page is the final-week
// test above. What only a browser shows: the card fits the two smallest phones the app is measured at, and its link opens
// the page for somebody the page admits.
const SELECTOR_NOTICE_DAY = new Date('2026-11-30T09:00:00Z');
for (const [width, height] of [[360, 740], [375, 667]]) {
    test(`Links Selector notice: fits a ${width}x${height} phone without scrolling, and its link opens the page for a colleague it is for`, async ({ page }) => {
        const errors = collectFatalErrors(page);
        await page.setViewportSize({ width, height });
        await page.clock.setFixedTime(SELECTOR_NOTICE_DAY);
        await seedSession(page, NEWLINK_COLLEAGUE);
        await seedMemberSession(page, NEWLINK_COLLEAGUE);
        await clearNoticeFlags(page, ['myb_notice_links_selector_2026_done']);   // after the seeders: last write wins
        await page.goto('/');
        const notice = page.locator('#selectorNoticeLb');
        await expect(notice, 'every notice before it answered by the seeders').toHaveClass(/\bopen\b/, { timeout: 15_000 });
        await expect(page.locator('#selectorNoticeContent .lightbox-app-name')).toHaveText('See the proposals as a calendar');
        await page.waitForTimeout(600);                           // the open transition, so the card is measured at rest
        const fit = await page.locator('#selectorNoticeContent').evaluate(el => el.scrollHeight - el.clientHeight);
        expect(fit, 'the card scrolls inside itself').toBeLessThanOrEqual(0);
        const go = page.locator('#selectorNoticeGo');
        // The rendered lines of its words, by their distinct tops — its line-height is `normal`, so a height says nothing.
        const lines = await go.evaluate(el => { const r = document.createRange(); r.selectNodeContents(el);
            return new Set([...r.getClientRects()].map(b => Math.round(b.top))).size; });
        expect(lines, 'the button keeps to one line').toBe(1);
        // The flag is read AS THE LINK IS PRESSED (the New link notice's test says why).
        await page.evaluate(() => document.addEventListener('click', () => {
            sessionStorage.setItem('__selectorDoneAtClick', localStorage.getItem('myb_notice_links_selector_2026_done') ?? 'unset');
        }));
        await go.click();
        await expect(page).toHaveURL(/\/links-selector\.html$/);
        await expect(page.locator('#calendarDisplay .calendar-day').first(), 'the page let them in').toBeVisible({ timeout: 15_000 });
        await expect(page.locator('#selectorNotForYou'), 'never the page\'s refusal card').toHaveCount(0);
        expect(await page.evaluate(() => sessionStorage.getItem('__selectorDoneAtClick')), 'the link marks it done as it is pressed').toBe('1');
        const filed = await page.evaluate(() => JSON.parse(localStorage.getItem('myb_app_notices') || '[]')
            .filter((/** @type {any} */ n) => n.id === 'links-selector-2026').map((/** @type {any} */ n) => n.section));
        expect(filed, 'archived on open, under its own section').toEqual(['Links Selector']);
        expect(errors).toHaveLength(0);
    });
}

test('Links Selector notice: never for a colleague the page turns away — and not flagged', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await page.clock.setFixedTime(SELECTOR_NOTICE_DAY);
    await seedSession(page, NOT_NEWLINK);
    await seedMemberSession(page, NOT_NEWLINK);
    await clearNoticeFlags(page, ['myb_notice_links_selector_2026_done']);
    await page.goto('/');
    await page.waitForSelector('#calendarDisplay table, #calendarDisplay .calendar-container', { timeout: 15_000 });
    await page.waitForTimeout(2500);                          // past the 1,500ms defer
    await expect(page.locator('#selectorNoticeLb')).not.toHaveClass(/\bopen\b/);
    expect(await page.evaluate(() => localStorage.getItem('myb_notice_links_selector_2026_done')), 'refused, so left unflagged').toBeNull();
    expect(errors).toHaveLength(0);
});

test('App Notices with nothing on this device says where notices appear, not that there were none', async ({ page }) => {
    // The archive is this device's own storage, and Safari wipes it, and the installed app keeps a
    // separate one — so an empty list says nothing about whether notices were posted.
    await seedMember(page);   // marks the live notices done without archiving them: the list stays empty
    await page.goto('/');
    await expect(page.locator('.calendar-day').first()).toBeVisible();
    await page.locator('#navMenuBtn').click();                 // Reference is expanded by default (v20.09)
    await page.locator('.nav-panel-link--notices').first().click();
    const empty = page.locator('#navNoticesEmpty');
    await expect(empty).toBeVisible();
    await expect(empty).toHaveText('Notices shown on this device appear here.');
    await expect(empty).not.toContainText('No notices');
});
